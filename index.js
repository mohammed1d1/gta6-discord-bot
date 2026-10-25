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
const UPDATE_INTERVAL_MS = 60 * 1000;
const MIN_RENAME_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_SETTINGS = Object.freeze({ updateMinutes: 1, releasedMessage: '🎉 GTA 6 نزلت!' });
const STORE_PATH = path.join(__dirname, 'gta_channel.json');
const SETTINGS_PATH = path.join(__dirname, 'gta_settings.json');
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

function countdownName(now = Date.now(), releasedMessage = DEFAULT_SETTINGS.releasedMessage) {
  const remaining = RELEASE_AT - now;
  if (remaining <= 0) return releasedMessage;
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
  constructor(file = STORE_PATH, validate = validateMapping) {
    this.file = file;
    this.validate = validate;
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
    return this.validate(JSON.parse(await fs.readFile(this.file, 'utf8')));
  }

  update(mutator) {
    const operation = this.queue.then(async () => {
      const mapping = await this.read();
      mutator(mapping);
      this.validate(mapping);
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

function validateSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid settings');
  for (const [guildId, settings] of Object.entries(value)) {
    if (!/^[1-9]\d{16,19}$/.test(guildId) || !settings || typeof settings !== 'object'
      || Array.isArray(settings) || Object.keys(settings).some(key => !['updateMinutes', 'releasedMessage'].includes(key))
      || !Number.isInteger(settings.updateMinutes) || settings.updateMinutes < 1 || settings.updateMinutes > 1440
      || typeof settings.releasedMessage !== 'string' || settings.releasedMessage.length > 100
      || !settings.releasedMessage.trim() || /[\r\n\u0000-\u001f\u007f]/u.test(settings.releasedMessage)) {
      throw new Error('Invalid guild settings');
    }
  }
  return value;
}

class SettingsStore extends ChannelStore {
  constructor(file = SETTINGS_PATH) {
    super(file, validateSettings);
  }

  patch(guildId, changes) {
    return this.update(mapping => {
      mapping[guildId] = { ...DEFAULT_SETTINGS, ...mapping[guildId], ...changes };
    });
  }
}

function isUnknownChannel(error) {
  return Number(error?.code) === 10003;
}

function createBot({ client, rest, store, settingsStore, logger = log, now = Date.now,
  monotonicNow = () => performance.now() }) {
  const settingUp = new Set();
  const nextRenameAt = new Map();
  const nextCheckAt = new Map();
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
    if (!interaction.isChatInputCommand() || !['setup_gta', 'gta_settings'].includes(interaction.commandName)) return;
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
      if (interaction.commandName === 'gta_settings') {
        const updateMinutes = interaction.options.getInteger('interval_minutes');
        const releasedMessage = interaction.options.getString('released_message');
        const changes = {};
        if (updateMinutes !== null) changes.updateMinutes = updateMinutes;
        if (releasedMessage !== null) changes.releasedMessage = releasedMessage.trim();
        try {
          validateSettings({ [guild.id]: { ...DEFAULT_SETTINGS, ...changes } });
        } catch {
          await interaction.editReply('❌ اختر فترة من 1 إلى 1440 دقيقة ورسالة غير فارغة من 1 إلى 100 حرف دون أسطر جديدة.');
          return;
        }
        if (Object.keys(changes).length) {
          await settingsStore.patch(guild.id, changes);
          nextCheckAt.delete(guild.id);
        }
        const settings = (await settingsStore.read())[guild.id] ?? DEFAULT_SETTINGS;
        await interaction.editReply({
          content: `⚙️ فترة الفحص: ${settings.updateMinutes} دقيقة.\n🙌 رسالة انتهاء العد (اسم القناة): ${settings.releasedMessage}\nتغيير اسم القناة محمي بفاصل خمس دقائق على الأقل. تُطبق التغييرات في دورة مؤهلة قادمة.`,
          allowedMentions: { parse: [] },
        });
        return;
      }
      const settings = (await settingsStore.read())[guild.id] ?? DEFAULT_SETTINGS;
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
        name: countdownName(now(), settings.releasedMessage), type: ChannelType.GuildVoice, position: 0,
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
      nextRenameAt.set(channel.id, monotonicNow() + MIN_RENAME_INTERVAL_MS);
      logger(`تم إنشاء قناة العد التنازلي ${channel.id} في السيرفر ${guild.id}.`);
      await interaction.editReply(`✅ تم إنشاء قناة العد التنازلي للعبة GTA 6: <#${channel.id}>\n🔒 القناة مرئية للجميع ومغلقة للاتصال الافتراضي. فترة الفحص: ${settings.updateMinutes} دقيقة؛ تغيير الاسم بفاصل خمس دقائق على الأقل.\n⚙️ لتغيير الإعدادات: /gta_settings\n📅 موعد انتهاء العد: ${timestamp.format(new Date(RELEASE_AT))} (${timestamp.resolvedOptions().timeZone}).`);
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
      const allSettings = await settingsStore.read();
      for (const [guildId, channelId] of Object.entries(mapping)) {
        if (stopped) break;
        if (settingUp.has(guildId)) continue;
        const guild = client.guilds.cache.get(guildId);
        // Unavailable guilds are retained; an outage must not erase configuration.
        if (!guild?.available) continue;
        const settings = allSettings[guildId] ?? DEFAULT_SETTINGS;
        const checkTime = monotonicNow();
        if (checkTime < (nextCheckAt.get(guildId) ?? 0)
          || checkTime < (nextRenameAt.get(channelId) ?? 0)) continue;
        nextCheckAt.set(guildId, checkTime + settings.updateMinutes * 60_000);
        try {
          const channel = await fetchVoiceChannel(guild, channelId);
          if (!channel) {
            await store.remove(guildId, channelId);
            nextRenameAt.delete(channelId);
            nextCheckAt.delete(guildId);
            logger(`تم حذف مرجع القناة المحذوفة ${channelId} من الحفظ.`);
            continue;
          }
          const newName = countdownName(now(), settings.releasedMessage);
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
            nextRenameAt.set(channelId, monotonicNow() + MIN_RENAME_INTERVAL_MS);
          }
        } catch (error) {
          logger(`تعذر تحديث القناة ${channelId}؛ ستتم المحاولة في الدورة القادمة.`, error);
        }
      }
    } catch (error) {
      logger('تعذرت قراءة ملف القنوات أو الإعدادات. لم يتم تعديل البيانات المحفوظة.', error);
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
    const settingsCommand = new SlashCommandBuilder()
      .setName('gta_settings')
      .setDescription('تغيير فترة فحص العد التنازلي ورسالة انتهاء العد أو عرض الإعدادات')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .setContexts(InteractionContextType.Guild)
      .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
      .addIntegerOption(option => option.setName('interval_minutes')
        .setDescription('فترة الفحص بالدقائق، الافتراضي 1 (تغيير الاسم بفاصل 5 دقائق على الأقل)')
        .setMinValue(1).setMaxValue(1440))
      .addStringOption(option => option.setName('released_message')
        .setDescription('اسم القناة عند انتهاء العد، يدعم الإيموجي')
        .setMinLength(1).setMaxLength(100));
    await rest.post(Routes.applicationCommands(client.user.id), { body: settingsCommand.toJSON() });
    logger('تم تسجيل الأمرين /setup_gta و/gta_settings والبوت جاهز.');
    if (!stopped && !timer) {
      // Keep restart cycles from bypassing the rename safety window.
      for (const channelId of Object.values(await store.read())) {
        nextRenameAt.set(channelId, monotonicNow() + MIN_RENAME_INTERVAL_MS);
      }
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
  const settingsStore = new SettingsStore();
  await settingsStore.initialize();
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  const rest = new REST({ version: '10', timeout: 15_000 }).setToken(token);
  const bot = createBot({ client, rest, store, settingsStore });
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
      await settingsStore.queue;
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
    log('فشل بدء التشغيل. تحقق من DISCORD_TOKEN وTIMEZONE وملفات JSON وإمكانية الكتابة في المجلد.', error);
    process.exitCode = 1;
  });
}

module.exports = { countdownName, validateMapping, validateSettings, ChannelStore, SettingsStore,
  createBot, createTimeFormatter, RELEASE_AT, UPDATE_INTERVAL_MS, MIN_RENAME_INTERVAL_MS, DEFAULT_SETTINGS };
