'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ChannelType, PermissionFlagsBits, Routes, InteractionContextType,
  ApplicationIntegrationType } = require('discord.js');
const { countdownName, validateMapping, ChannelStore, createBot,
  RELEASE_AT, UPDATE_INTERVAL_MS } = require('../index');

const GUILD = '111111111111111111';
const CHANNEL = '222222222222222222';
const BOT = '333333333333333333';

function fixture(initial = { [GUILD]: CHANNEL }) {
  let mapping = { ...initial };
  let time = 0;
  const calls = { names: [], replies: [], deferred: [], create: [], commands: [], deletes: 0 };
  const channel = {
    id: CHANNEL, guildId: GUILD, type: ChannelType.GuildVoice, name: 'old name',
    permissionsFor: () => ({ has: () => true }),
    setName: async name => { calls.names.push(name); channel.name = name; },
    delete: async () => { calls.deletes++; },
  };
  const guild = {
    id: GUILD, available: true, roles: { everyone: { id: GUILD } },
    members: { me: {}, fetchMe: async () => ({ permissions: { has: () => true } }) },
    channels: {
      fetch: async () => channel,
      create: async options => { calls.create.push(options); return channel; },
    },
  };
  const client = { user: { id: BOT }, guilds: { cache: new Map([[GUILD, guild]]) } };
  const store = {
    read: async () => ({ ...mapping }),
    set: async (g, c) => { mapping[g] = c; },
    remove: async (g, c) => { if (mapping[g] === c) delete mapping[g]; },
  };
  const rest = { post: async (route, body) => { calls.commands.push({ route, ...body }); } };
  const interaction = {
    commandName: 'setup_gta', guild,
    isChatInputCommand: () => true, inGuild: () => true,
    memberPermissions: { has: permission => permission === PermissionFlagsBits.Administrator },
    deferReply: async options => { calls.deferred.push(options); },
    editReply: async reply => { calls.replies.push(reply); },
  };
  const bot = createBot({ client, rest, store, logger: () => {},
    now: () => RELEASE_AT - 90_000 + time, monotonicNow: () => time });
  return { bot, calls, channel, guild, store, interaction,
    advance: milliseconds => { time += milliseconds; } };
}

test('countdown uses the fixed UTC target and handles release boundaries', () => {
  assert.equal(new Date(RELEASE_AT).toISOString(), '2026-11-18T22:00:00.000Z');
  assert.equal(countdownName(RELEASE_AT - ((2 * 24 + 3) * 60 + 4) * 60_000), '⏳ GTA 6: 2d 3h 4m');
  assert.equal(countdownName(RELEASE_AT - 1), '⏳ GTA 6: 0d 0h 0m');
  assert.equal(countdownName(RELEASE_AT), '🎉 GTA 6 نزلت!');
  assert.equal(countdownName(RELEASE_AT + 1), '🎉 GTA 6 نزلت!');
  assert.equal(UPDATE_INTERVAL_MS, 300_000);
});

test('mapping validation rejects malformed data and unsafe keys', () => {
  for (const invalid of [null, [], 'x', { [GUILD]: 12 }, { bad: CHANNEL },
    JSON.parse('{"__proto__":"222222222222222222"}')]) {
    assert.throws(() => validateMapping(invalid));
  }
  assert.deepEqual(validateMapping({ [GUILD]: CHANNEL }), { [GUILD]: CHANNEL });
});

test('atomic store serializes writes, survives restart, and preserves corrupt data', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gta-bot-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'gta_channel.json');
  const store = new ChannelStore(file);
  await store.initialize();
  await Promise.all([store.set(GUILD, CHANNEL), store.set(BOT, CHANNEL)]);
  const restarted = new ChannelStore(file);
  await restarted.initialize();
  assert.deepEqual(await restarted.read(), { [GUILD]: CHANNEL, [BOT]: CHANNEL });
  await store.remove(GUILD, BOT); // A stale cleanup must not remove a replacement.
  assert.equal((await store.read())[GUILD], CHANNEL);
  await store.remove(GUILD, CHANNEL);
  assert.deepEqual(await store.read(), { [BOT]: CHANNEL });
  assert.deepEqual(await fs.readdir(directory), ['gta_channel.json']);
  await fs.writeFile(file, '{broken');
  await assert.rejects(restarted.initialize());
  await assert.rejects(store.set(GUILD, CHANNEL));
  assert.equal(await fs.readFile(file, 'utf8'), '{broken');
  await fs.writeFile(file, '{}');
  await store.set(GUILD, CHANNEL); // A rejected write does not poison the queue.
  assert.equal((await store.read())[GUILD], CHANNEL);
});

test('setup creates and persists the exact locked voice channel', async () => {
  const f = fixture({});
  await f.bot.setup(f.interaction);
  assert.deepEqual(f.calls.deferred, [{ ephemeral: true }]);
  assert.equal(f.calls.create.length, 1);
  const options = f.calls.create[0];
  assert.equal(options.position, 0);
  assert.equal(options.type, ChannelType.GuildVoice);
  assert.equal(options.name, '⏳ GTA 6: 0d 0h 1m');
  assert.deepEqual(options.permissionOverwrites, [
    { id: GUILD, allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.Connect] },
    { id: BOT, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.ManageChannels] },
  ]);
  assert.equal((await f.store.read())[GUILD], CHANNEL);
  assert.match(f.calls.replies[0], /تم إنشاء/);
});

test('setup refuses non-administrators and DMs', async () => {
  for (const kind of ['non-admin', 'dm']) {
    const f = fixture({});
    if (kind === 'dm') f.interaction.inGuild = () => false;
    else f.interaction.memberPermissions.has = () => false;
    await f.bot.setup(f.interaction);
    assert.equal(f.calls.create.length, 0);
    assert.match(f.calls.replies[0], /مسؤولي/);
  }
});

test('setup reuses an existing channel without renaming it', async () => {
  const f = fixture();
  await f.bot.setup(f.interaction);
  assert.equal(f.calls.create.length, 0);
  assert.equal(f.calls.names.length, 0);
  assert.match(f.calls.replies[0], /موجودة بالفعل/);
});

test('concurrent setup requests create only one channel', async () => {
  const f = fixture({});
  await Promise.all([f.bot.setup(f.interaction), f.bot.setup(f.interaction)]);
  assert.equal(f.calls.create.length, 1);
});

test('setup checks bot permissions and rolls back on persistence failure', async () => {
  const denied = fixture({});
  denied.guild.members.fetchMe = async () => ({ permissions: { has: () => false } });
  await denied.bot.setup(denied.interaction);
  assert.equal(denied.calls.create.length, 0);
  const failed = fixture({});
  failed.store.set = async () => { throw new Error('Disk full'); };
  await assert.rejects(failed.bot.setup(failed.interaction));
  assert.equal(failed.calls.deletes, 1);
});

test('only a confirmed missing channel is replaced by setup', async () => {
  const missing = fixture();
  missing.guild.channels.fetch = async () => { throw Object.assign(new Error(), { code: 10003 }); };
  await missing.bot.setup(missing.interaction);
  assert.equal(missing.calls.create.length, 1);
  const inaccessible = fixture();
  inaccessible.guild.channels.fetch = async () => { throw Object.assign(new Error(), { code: 50001 }); };
  await assert.rejects(inaccessible.bot.setup(inaccessible.interaction));
  assert.equal(inaccessible.calls.create.length, 0);
});

test('updates skip unchanged names and enforce spacing between attempts', async () => {
  const f = fixture();
  await f.bot.updateChannels();
  await f.bot.updateChannels();
  assert.equal(f.calls.names.length, 1);
  f.channel.name = 'externally changed';
  f.advance(UPDATE_INTERVAL_MS - 1);
  await f.bot.updateChannels();
  assert.equal(f.calls.names.length, 1);
  f.advance(1);
  await f.bot.updateChannels();
  assert.deepEqual(f.calls.names, ['⏳ GTA 6: 0d 0h 1m', '🎉 GTA 6 نزلت!']);
  f.advance(UPDATE_INTERVAL_MS);
  await f.bot.updateChannels();
  assert.equal(f.calls.names.length, 2);
});

test('an in-flight update cannot overlap another cycle', async () => {
  const f = fixture();
  let resolve;
  let started;
  const entered = new Promise(r => { started = r; });
  f.channel.setName = async name => {
    f.calls.names.push(name);
    started();
    await new Promise(r => { resolve = r; });
  };
  const first = f.bot.updateChannels();
  await entered;
  await f.bot.updateChannels();
  assert.equal(f.calls.names.length, 1);
  resolve();
  await first;
  f.bot.stop();
  await f.bot.drain();
  f.advance(UPDATE_INTERVAL_MS);
  await f.bot.updateChannels();
  assert.equal(f.calls.names.length, 1);
});

test('unknown channels are pruned; transient errors and permission failures are retained', async () => {
  for (const code of [10003, 50001, 50013, 'ECONNRESET']) {
    const f = fixture();
    f.guild.channels.fetch = async () => { throw Object.assign(new Error(), { code }); };
    await f.bot.updateChannels();
    assert.equal((await f.store.read())[GUILD], code === 10003 ? undefined : CHANNEL);
  }
});

test('unavailable guilds, wrong channel types, and missing permissions are skipped', async () => {
  for (const mode of ['unavailable', 'type', 'permission']) {
    const f = fixture();
    if (mode === 'unavailable') f.guild.available = false;
    if (mode === 'type') f.channel.type = ChannelType.GuildText;
    if (mode === 'permission') f.channel.permissionsFor = () => ({ has: () => false });
    await f.bot.updateChannels();
    assert.equal(f.calls.names.length, 0);
    assert.equal((await f.store.read())[GUILD], CHANNEL);
  }
});

test('ready registers the global administrator-only guild command', async t => {
  const f = fixture();
  t.after(() => f.bot.stop());
  await f.bot.ready();
  const registration = f.calls.commands[0];
  assert.equal(registration.route, Routes.applicationCommands(BOT));
  assert.equal(registration.body.name, 'setup_gta');
  assert.equal(registration.body.default_member_permissions, PermissionFlagsBits.Administrator.toString());
  assert.deepEqual(registration.body.contexts, [InteractionContextType.Guild]);
  assert.deepEqual(registration.body.integration_types, [ApplicationIntegrationType.GuildInstall]);
  assert.equal(f.calls.names.length, 0); // No burst of renames on restart.
});
