'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ChannelType, PermissionFlagsBits, Routes, InteractionContextType,
  ApplicationIntegrationType } = require('discord.js');
const { countdownName, validateMapping, ChannelStore, createBot,
  RELEASE_AT, UPDATE_INTERVAL_MS, MIN_RENAME_INTERVAL_MS, DEFAULT_SETTINGS,
  SettingsStore, validateSettings, createTimeFormatter } = require('../index');

const GUILD = '111111111111111111';
const CHANNEL = '222222222222222222';
const BOT = '333333333333333333';

test('time zone settings default to UTC, convert dates, and reject invalid zones', () => {
  assert.equal(createTimeFormatter().resolvedOptions().timeZone, 'UTC');
  assert.equal(createTimeFormatter('  ').resolvedOptions().timeZone, 'UTC');
  const instant = new Date('2026-01-01T12:00:00Z');
  assert.equal(createTimeFormatter(' UTC ').format(instant), '01/01/2026, 12:00:00');
  assert.equal(createTimeFormatter('America/New_York').format(instant), '01/01/2026, 07:00:00');
  assert.equal(createTimeFormatter('America/New_York').format(new Date('2026-07-01T12:00:00Z')), '01/07/2026, 08:00:00');
  assert.throws(() => createTimeFormatter('Invalid/Zone'), { code: 'INVALID_TIMEZONE' });
});

function fixture(initial = { [GUILD]: CHANNEL }) {
  let mapping = { ...initial };
  const savedSettings = {};
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
  const settingsStore = {
    read: async () => structuredClone(savedSettings),
    patch: async (guildId, changes) => {
      savedSettings[guildId] = { ...DEFAULT_SETTINGS, ...savedSettings[guildId], ...changes };
    },
  };
  const interaction = {
    commandName: 'setup_gta', guild,
    isChatInputCommand: () => true, inGuild: () => true,
    memberPermissions: { has: permission => permission === PermissionFlagsBits.Administrator },
    deferReply: async options => { calls.deferred.push(options); },
    editReply: async reply => { calls.replies.push(reply); },
  };
  const bot = createBot({ client, rest, store, settingsStore, logger: () => {},
    now: () => RELEASE_AT - 90_000 + time, monotonicNow: () => time });
  return { bot, calls, channel, guild, store, settingsStore, interaction,
    advance: milliseconds => { time += milliseconds; } };
}

test('countdown uses the fixed UTC target and handles release boundaries', () => {
  assert.equal(new Date(RELEASE_AT).toISOString(), '2026-11-18T22:00:00.000Z');
  assert.equal(countdownName(RELEASE_AT - ((2 * 24 + 3) * 60 + 4) * 60_000), '⏳ GTA 6: 2d 3h 4m');
  assert.equal(countdownName(RELEASE_AT - 1), '⏳ GTA 6: 0d 0h 0m');
  assert.equal(countdownName(RELEASE_AT), '🎉 GTA 6 نزلت!');
  assert.equal(countdownName(RELEASE_AT + 1), '🎉 GTA 6 نزلت!');
  assert.equal(UPDATE_INTERVAL_MS, 60_000);
  assert.equal(MIN_RENAME_INTERVAL_MS, 300_000);
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
  f.advance(MIN_RENAME_INTERVAL_MS - 1);
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
  assert.equal(f.calls.commands.length, 2);
  const settings = f.calls.commands[1].body;
  assert.equal(settings.name, 'gta_settings');
  assert.equal(settings.default_member_permissions, PermissionFlagsBits.Administrator.toString());
  assert.equal(settings.options[0].min_value, 1);
  assert.equal(settings.options[0].max_value, 1440);
  assert.equal(settings.options[1].max_length, 100);
});

function settingsInteraction(f, interval = null, message = null) {
  return { ...f.interaction, commandName: 'gta_settings', options: {
    getInteger: () => interval, getString: () => message,
  } };
}

test('settings command shows the one-minute default and persists independent options', async () => {
  const f = fixture();
  await f.bot.setup(settingsInteraction(f));
  assert.match(f.calls.replies[0].content, /فترة الفحص: 1 دقيقة/);
  assert.deepEqual(await f.settingsStore.read(), {});
  await f.bot.setup(settingsInteraction(f, 10, '🙌 GTA 6 is here!'));
  await f.bot.setup(settingsInteraction(f, 2));
  assert.deepEqual((await f.settingsStore.read())[GUILD], {
    updateMinutes: 2, releasedMessage: '🙌 GTA 6 is here!',
  });
  assert.equal((await f.settingsStore.read())[BOT], undefined);
  assert.deepEqual(f.calls.replies.at(-1).allowedMentions, { parse: [] });
  assert.equal(f.calls.create.length, 0);
});

test('settings rejects invalid intervals, blank/long messages, and unauthorized callers', async () => {
  for (const [interval, message] of [[0, null], [1441, null], [1.5, null],
    [null, '   '], [null, 'a'.repeat(101)], [null, 'two\nlines']]) {
    const f = fixture();
    await f.bot.setup(settingsInteraction(f, interval, message));
    assert.match(f.calls.replies[0], /❌/);
    assert.deepEqual(await f.settingsStore.read(), {});
  }
  for (const kind of ['non-admin', 'dm']) {
    const f = fixture();
    const interaction = settingsInteraction(f, 1, '🙌 Released!');
    if (kind === 'dm') interaction.inGuild = () => false;
    else interaction.memberPermissions = { has: () => false };
    await f.bot.setup(interaction);
    assert.deepEqual(await f.settingsStore.read(), {});
    assert.match(f.calls.replies[0], /مسؤولي/);
  }
});

test('custom release names apply after release and changes respect the rename safety window', async () => {
  const f = fixture();
  await f.bot.setup(settingsInteraction(f, 1, '🙌 Released!'));
  f.advance(90_000);
  await f.bot.updateChannels();
  assert.deepEqual(f.calls.names, ['🙌 Released!']);
  await f.bot.setup(settingsInteraction(f, null, '🎮 Play now!'));
  f.advance(UPDATE_INTERVAL_MS);
  await f.bot.updateChannels();
  assert.equal(f.calls.names.length, 1);
  f.advance(MIN_RENAME_INTERVAL_MS - UPDATE_INTERVAL_MS);
  await f.bot.updateChannels();
  assert.deepEqual(f.calls.names, ['🙌 Released!', '🎮 Play now!']);
});

test('per-guild intervals govern checks and shortening an interval schedules the next tick', async () => {
  const f = fixture();
  let fetches = 0;
  f.guild.channels.fetch = async () => { fetches++; return f.channel; };
  await f.bot.setup(settingsInteraction(f, 10));
  await f.bot.updateChannels();
  assert.equal(fetches, 1);
  f.advance(6 * UPDATE_INTERVAL_MS);
  await f.bot.updateChannels();
  assert.equal(fetches, 1);
  await f.bot.setup(settingsInteraction(f, 1));
  await f.bot.updateChannels();
  assert.equal(fetches, 2);
});

test('setup uses the configured released name when creating a channel after release', async () => {
  const f = fixture({});
  await f.bot.setup(settingsInteraction(f, 1, '🙌 Available!'));
  f.advance(90_000);
  await f.bot.setup(f.interaction);
  assert.equal(f.calls.create[0].name, '🙌 Available!');
});

test('settings persistence survives restart and concurrent patches preserve other fields', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gta-settings-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'gta_settings.json');
  const store = new SettingsStore(file);
  await store.initialize();
  await Promise.all([store.patch(GUILD, { updateMinutes: 3 }),
    store.patch(GUILD, { releasedMessage: '🙌 Ready!' }), store.patch(BOT, { updateMinutes: 15 })]);
  const restarted = new SettingsStore(file);
  await restarted.initialize();
  assert.deepEqual((await restarted.read())[GUILD], { updateMinutes: 3, releasedMessage: '🙌 Ready!' });
  assert.equal((await restarted.read())[BOT].updateMinutes, 15);
  await assert.rejects(store.patch(GUILD, { updateMinutes: 0 }));
  assert.equal((await restarted.read())[GUILD].updateMinutes, 3);
  await fs.writeFile(file, '{broken');
  await assert.rejects(restarted.initialize());
  assert.equal(await fs.readFile(file, 'utf8'), '{broken');
  assert.throws(() => validateSettings({ [GUILD]: { ...DEFAULT_SETTINGS, extra: true } }));
});

test('restart cooldown prevents the one-minute poll or settings edits from renaming early', async t => {
  const f = fixture();
  t.after(() => f.bot.stop());
  await f.bot.ready();
  f.advance(UPDATE_INTERVAL_MS);
  await f.bot.setup(settingsInteraction(f, 1, '🙌 Ready!'));
  await f.bot.updateChannels();
  assert.equal(f.calls.names.length, 0);
  f.advance(MIN_RENAME_INTERVAL_MS - UPDATE_INTERVAL_MS);
  await f.bot.updateChannels();
  assert.deepEqual(f.calls.names, ['🙌 Ready!']);
});

test('failed settings writes do not report success or leave the guild locked', async () => {
  const f = fixture();
  const originalPatch = f.settingsStore.patch;
  f.settingsStore.patch = async () => { throw new Error('Disk full'); };
  await assert.rejects(f.bot.setup(settingsInteraction(f, 5)));
  assert.equal(f.calls.replies.length, 0);
  f.settingsStore.patch = originalPatch;
  await f.bot.setup(settingsInteraction(f, 2));
  assert.equal((await f.settingsStore.read())[GUILD].updateMinutes, 2);
});
