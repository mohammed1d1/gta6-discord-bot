# GTA 6 Countdown Bot

## العربية

بوت Discord ينشئ قناة للعد التنازلي. فترة الفحص الافتراضية دقيقة واحدة، وتغيير الاسم محمي بفاصل 5 دقائق على الأقل.

### التشغيل

تحتاج إلى **Node.js 24.17.0 أو أحدث** وnpm.

1. أنشئ بوتاً من [بوابة مطوري Discord](https://discord.com/developers/applications).
2. ادعُه إلى سيرفرك بالنطاقين `bot` و`applications.commands` وصلاحيات عرض القنوات والاتصال وإدارة القنوات.
3. نزّل المشروع وثبّت الحزم:

```sh
git clone https://github.com/mohammed1d1/gta6-discord-bot.git
cd gta6-discord-bot
npm ci
```

4. انسخ `.env.example` إلى ملف اسمه `.env`، ثم ضع توكن البوت:

```env
DISCORD_TOKEN=your_bot_token_here
TIMEZONE=UTC
```

**لا تشارك التوكن أو ترفع `.env` إلى GitHub.**

5. شغّل البوت:

```sh
npm start
```

6. نفّذ `/setup_gta` داخل السيرفر بحساب لديه صلاحية المسؤول.

### إعدادات العد التنازلي

للمسؤولين فقط، دون إعادة تشغيل البوت:

```text
/gta_settings interval_minutes: 1
/gta_settings released_message: 🙌 GTA 6 نزلت!
```

الفترة من 1 إلى 1440 دقيقة، والرسالة من 1 إلى 100 حرف وتصبح اسم القناة عند انتهاء العد. يمكنك جمع الخيارين في أمر واحد. نفّذ `/gta_settings` دون خيارات لعرض الإعدادات.

تُحفظ الإعدادات لكل سيرفر في `gta_settings.json` وتُطبق في دورة مؤهلة قادمة. الفحص كل دقيقة لا يعني تغيير الاسم كل دقيقة؛ توجد حماية بفاصل 5 دقائق على الأقل، وقد تؤخر الشبكة وقيود Discord التحديث أكثر. أول تغيير بعد إعادة التشغيل ينتظر 5 دقائق على الأقل.

### تغيير التوقيت

غيّر `TIMEZONE` في `.env` ثم أعد تشغيل البوت، مثلاً:

```env
TIMEZONE=Europe/London
```

هذا يغيّر توقيت السجل والموعد المعروض فقط. ينتهي العد في **18 نوفمبر 2026، الساعة 22:00 UTC**.

### ملاحظات

- شغّل نسخة واحدة فقط واحتفظ بملفي `gta_channel.json` و`gta_settings.json` بين مرات التشغيل. لا ترفعهما إلى GitHub.
- للاختبار: `npm test`.
- أُنشئ بمساعدة الذكاء الاصطناعي باستخدام **OpenAI Codex — GPT-6.1**.

---

## English

A Discord bot that creates a countdown channel. Checks default to once per minute; channel renames have a safety interval of at least 5 minutes.

### Setup

You need **Node.js 24.17.0 or newer** and npm.

1. Create a bot in the [Discord Developer Portal](https://discord.com/developers/applications).
2. Invite it with the `bot` and `applications.commands` scopes and **View Channels**, **Connect**, and **Manage Channels** permissions.
3. Clone the project and install dependencies:

```sh
git clone https://github.com/mohammed1d1/gta6-discord-bot.git
cd gta6-discord-bot
npm ci
```

4. Copy `.env.example` to `.env` and enter your bot token:

```env
DISCORD_TOKEN=your_bot_token_here
TIMEZONE=UTC
```

**Never share your token or upload `.env` to GitHub.**

5. Start the bot:

```sh
npm start
```

6. Run `/setup_gta` in your server as an administrator.

### Countdown settings

Administrators can change settings without restarting:

```text
/gta_settings interval_minutes: 1
/gta_settings released_message: 🙌 GTA 6 is here!
```

Choose 1–1440 minutes and a 1–100 character release message, used as the channel name when the countdown ends. Both options can be combined. Run `/gta_settings` without options to view settings.

Settings persist per server in `gta_settings.json` and apply on the next eligible cycle. One-minute checks do not mean one-minute renames: a safety interval of at least 5 minutes applies. Network delays and Discord rate limits may add delays. After a restart, the first rename waits at least 5 minutes.

### Change time zone

Change `TIMEZONE` in `.env`, then restart the bot. Example:

```env
TIMEZONE=Europe/London
```

This changes displayed times only. The countdown ends on **18 November 2026 at 22:00 UTC**.

### Notes

- Run one instance and keep `gta_channel.json` and `gta_settings.json` between restarts. Do not upload them to GitHub.
- Run tests: `npm test`.
- Created with AI assistance using **OpenAI Codex — GPT-6.1**.
