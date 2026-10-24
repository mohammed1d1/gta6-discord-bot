'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const {
  Client, Events, GatewayIntentBits, REST, Routes, SlashCommandBuilder,
  PermissionFlagsBits, ChannelType, InteractionContextType, ApplicationIntegrationType,
} = require('discord.js');

const RELEASE_AT = Date.parse('2026-11-18T22:00:00Z');
const UPDATE_INTERVAL_MS = 5 * 60 * 1000;
const STORE_PATH = path.join(__dirname, 'gta_channel.json');
function createTimeFormatter(timeZone = 'UTC') {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timeZone.trim() || 'UTC',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
  } catch {
    const error = new Error('Invalid TIMEZONE; use UTC or a valid IANA time zone');
    error.code = 'INVALID_TIMEZONE';
    throw error;
  }
}

let timestamp = createTimeFormatter();

function log(message, error) {
  // Never dump Discord request objects, headers, environment variables or tokens.
  const code = error && /^[A-Za-z0-9_-]{1,40}$/.test(String(error.code))
    ? ` [code=${error.code}]` : '';
  const line = `[${timestamp.format(new Date())} ${timestamp.resolvedOptions().timeZone}] ${message}${code}`;
  if (error) console.error(line);
  else console.log(line);
}

function countdownName(now = Date.now()) {
  const remaining = RELEASE_AT - now;
  if (remaining <= 0) return '🎉 GTA 6 نزلت!';
  const totalMinutes = Math.floor(remaining / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  return `⏳ GTA 6: ${days}d ${hours}h ${minutes}m`;
}

function validateMapping(value) {
  const snowflake = /^[1-9]\d{16,19}$/;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.entries(value).some(([guildId, channelId]) =>
      !snowflake.test(guildId) || typeof channelId !== 'string' || !snowflake.test(channelId))) {
    throw new Error('Invalid channel mapping');
  }
  return value;
}

class ChannelStore {
  constructor(file = STORE_PATH) {
    this.file = file;
    this.queue = Promise.resolve();
  }

  async initialize() {
    try {
      await fs.writeFile(this.file, '{}\n', { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    await this.read(); // Fail closed on corrupt data; do not silently erase it.
  }

  async read() {
    return validateMapping(JSON.parse(await fs.readFile(this.file, 'utf8')));
  }

  update(mutator) {
    const operation = this.queue.then(async () => {
      const mapping = await this.read();
      mutator(mapping);
      validateMapping(mapping);
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      let handle;
      try {
        handle = await fs.open(temporary, 'wx', 0o600);
        await handle.writeFile(`${JSON.stringify(mapping, null, 2)}\n`, 'utf8');
        await handle.sync();
        await handle.close();
        handle = undefined;
        await fs.rename(temporary, this.file);
      } finally {
        if (handle) await handle.close().catch(() => {});
        await fs.unlink(temporary).catch(error => {
          if (error.code !== 'ENOENT') log('تعذر تنظيف الملف المؤقت.', error);
        });
      }
    });
    this.queue = operation.catch(() => {});
    return operation;
  }

  set(guildId, channelId) {
    return this.update(mapping => { mapping[guildId] = channelId; });
  }

  remove(guildId, expectedChannelId) {
    return this.update(mapping => {
      if (mapping[guildId] === expectedChannelId) delete mapping[guildId];
    });
  }
}

function isUnknownChannel(error) {
  return Number(error?.code) === 10003;
}

function createBot({ client, rest, store, logger = log, now = Date.now,
  monotonicNow = () => performance.now() }) {
  const settingUp = new Set();
  const nextRenameAt = new Map();
  let updating = false;
  let timer;
  let stopped = false;
  let activeUpdate = Promise.resolve();

  async function fetchVoiceChannel(guild, channelId) {
    let channel;
    try {
      channel = await guild.channels.fetch(channelId, { force: true });
    } catch (error) {
      if (!isUnknownChannel(error)) throw error;
    }
    if (!channel) return null;
    if (channel.guildId !== guild.id || channel.type !== ChannelType.GuildVoice) {
      throw new Error('Saved channel is not a voice channel in this guild');
    }
    return channel;
  }

  async function setup(interaction) {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'setup_gta') return;
    await interaction.deferReply({ ephemeral: true });
    if (!interaction.inGuild() || !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      await interaction.editReply('❌ هذا الأمر متاح لمسؤولي السيرفر فقط.');
      return;
    }
    const guild = interaction.guild;
    if (stopped || !guild || !guild.available) {
      await interaction.editReply('❌ البوت أو السيرفر غير متاح حالياً. حاول لاحقاً.');
      return;
    }
    if (settingUp.has(guild.id)) {
      await interaction.editReply('⏳ يجري إعداد القناة بالفعل. انتظر قليلاً.');
      return;
    }
    settingUp.add(guild.id);
    try {
      const mapping = await store.read();
      if (mapping[guild.id]) {
        const existing = await fetchVoiceChannel(guild, mapping[guild.id]);
        if (existing) {
          await interaction.editReply(`✅ قناة العد التنازلي موجودة بالفعل: <#${existing.id}>`);
          return;
        }
      }
      const me = await guild.members.fetchMe();
      const required = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect,
        PermissionFlagsBits.ManageChannels];
      if (!me.permissions.has(required)) {
        await interaction.editReply('❌ أحتاج صلاحيات عرض القنوات والاتصال وإدارة القنوات لإعداد القناة وأذوناتها.');
        return;
      }
      const channel = await guild.channels.create({
        name: countdownName(now()), type: ChannelType.GuildVoice, position: 0,
        permissionOverwrites: [
          { id: guild.roles.everyone.id, allow: [PermissionFlagsBits.ViewChannel],
            deny: [PermissionFlagsBits.Connect] },
          { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.Connect, PermissionFlagsBits.ManageChannels] },
        ],
        reason: 'GTA 6 countdown requested by a server administrator',
      });
      try {
        await store.set(guild.id, channel.id);
      } catch (error) {
        // Roll back only the channel created by this invocation.
        try {
          await channel.delete('Countdown storage failed; rolling back creation');
        } catch (rollbackError) {
          logger(`تعذر التراجع عن إنشاء القناة ${channel.id}؛ يلزم حذفها يدوياً.`, rollbackError);
        }
        throw error;
      }
      nextRenameAt.set(channel.id, monotonicNow() + UPDATE_INTERVAL_MS);
      logger(`تم إنشاء قناة العد التنازلي ${channel.id} في السيرفر ${guild.id}.`);
      await interaction.editReply(`✅ تم إنشاء قناة العد التنازلي للعبة GTA 6: <#${channel.id}>\n🔒 القناة مرئية للجميع ومغلقة للاتصال الافتراضي. يتم تحديثها كل خمس دقائق.\n📅 موعد انتهاء العد: ${timestamp.format(new Date(RELEASE_AT))} (${timestamp.resolvedOptions().timeZone}).`);
    } finally {
      settingUp.delete(guild.id);
    }
  }

  function updateChannels() {
    if (updating || stopped) return Promise.resolve();
    activeUpdate = runUpdateChannels();
    return activeUpdate;
  }

  async function runUpdateChannels() {
    if (updating || stopped) return;
    updating = true;
    try {
      const mapping = await store.read();
      for (const [guildId, channelId] of Object.entries(mapping)) {
        if (stopped) break;
        if (settingUp.has(guildId)) continue;
        const guild = client.guilds.cache.get(guildId);
        // Unavailable guilds are retained; an outage must not erase configuration.
        if (!guild?.available) continue;
        try {
          const channel = await fetchVoiceChannel(guild, channelId);
          if (!channel) {
            await store.remove(guildId, channelId);
            nextRenameAt.delete(channelId);
            logger(`تم حذف مرجع القناة المحذوفة ${channelId} من الحفظ.`);
            continue;
          }
          const newName = countdownName(now());
          if (channel.name === newName || monotonicNow() < (nextRenameAt.get(channelId) ?? 0)) continue;
          const me = guild.members.me ?? await guild.members.fetchMe();
          if (!channel.permissionsFor(me)?.has(PermissionFlagsBits.ManageChannels)) {
            logger(`لا تتوفر صلاحية إدارة القناة ${channelId}؛ تم تخطي التحديث.`);
            continue;
          }
          try {
            await channel.setName(newName, 'Scheduled GTA 6 countdown update');
            logger(`تم تحديث القناة ${channelId}: ${newName}`);
          } finally {
            // Space completed attempts too, even if Discord delayed the REST request.
            nextRenameAt.set(channelId, monotonicNow() + UPDATE_INTERVAL_MS);
          }
        } catch (error) {
          logger(`تعذر تحديث القناة ${channelId}؛ ستتم المحاولة في الدورة القادمة.`, error);
        }
      }
    } catch (error) {
      logger('تعذرت قراءة ملف القنوات. لم يتم تعديل البيانات المحفوظة.', error);
    } finally {
      updating = false;
    }
  }

  async function ready() {
    const command = new SlashCommandBuilder()
      .setName('setup_gta')
      .setDescription('إنشاء قناة العد التنازلي للعبة GTA 6')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .setContexts(InteractionContextType.Guild)
      .setIntegrationTypes(ApplicationIntegrationType.GuildInstall);
    // POST upserts this named command without deleting other application commands.
    await rest.post(Routes.applicationCommands(client.user.id), { body: command.toJSON() });
    logger('تم تسجيل الأمر /setup_gta والبوت جاهز.');
    if (!stopped && !timer) {
      // Wait one interval after a restart rather than immediately renaming again.
      timer = setInterval(() => { void updateChannels(); }, UPDATE_INTERVAL_MS);
    }
  }

  function stop() {
    stopped = true;
    clearInterval(timer);
  }

  return { setup, updateChannels, ready, stop, drain: () => activeUpdate };
}

async function main() {
  require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });
  timestamp = createTimeFormatter(process.env.TIMEZONE);
  const token = process.env.DISCORD_TOKEN?.trim();
  if (!token || token === 'your_bot_token_here') {
    throw new Error('Set DISCORD_TOKEN in .env');
  }
  const store = new ChannelStore();
  await store.initialize();
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  const rest = new REST({ version: '10', timeout: 15_000 }).setToken(token);
  const bot = createBot({ client, rest, store });
  const pending = new Set();
  let shuttingDown = false;

  async function shutdown(exitCode = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
    process.exitCode = exitCode;
    bot.stop();
    log('جارٍ إيقاف البوت...');
    const deadline = setTimeout(() => process.exit(exitCode || 1), 15_000);
    try {
      await Promise.allSettled([...pending]);
      await bot.drain();
      await store.queue;
      await client.destroy();
    } finally {
      clearTimeout(deadline);
    }
  }

  function track(operation) {
    pending.add(operation);
    void operation.finally(() => pending.delete(operation)).catch(() => {});
  }

  client.once(Events.ClientReady, () => {
    track(bot.ready().catch(async error => {
      log('فشل تسجيل الأمر. تحقق من إعدادات التطبيق والاتصال.', error);
      // Do not wait for this callback from inside itself.
      setImmediate(() => { void shutdown(1); });
    }));
  });
  client.on(Events.InteractionCreate, interaction => {
    if (shuttingDown) return;
    track(bot.setup(interaction).catch(async error => {
      log('تعذر إكمال إعداد القناة. تحقق من الصلاحيات وملف الحفظ.', error);
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply('❌ تعذر إكمال العملية. تحقق من صلاحيات البوت وسجل التشغيل وملف الحفظ، ثم حاول مجدداً.')
          .catch(replyError => log('تعذر إرسال رد الخطأ.', replyError));
      }
    }));
  });
  client.on(Events.Error, error => log('حدث خطأ في اتصال البوت.', error));
  client.on(Events.ShardError, error => log('حدث خطأ في اتصال البوابة.', error));
  process.once('SIGINT', () => { void shutdown(); });
  process.once('SIGTERM', () => { void shutdown(); });
  try {
    await client.login(token);
  } catch (error) {
    log('فشل تسجيل الدخول. تحقق من DISCORD_TOKEN والاتصال بالشبكة.', error);
    await shutdown(1);
  }
}

if (require.main === module) {
  main().catch(error => {
    log('فشل بدء التشغيل. تحقق من DISCORD_TOKEN وTIMEZONE وصلاحية gta_channel.json وإمكانية الكتابة في المجلد.', error);
    process.exitCode = 1;
  });
}

module.exports = { countdownName, validateMapping, ChannelStore, createBot, createTimeFormatter, RELEASE_AT, UPDATE_INTERVAL_MS };
