# GTA 6 Countdown Bot

## العربية

بوت Discord ينشئ قناة للعد التنازلي ويحدّث اسمها كل 5 دقائق.

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

### تغيير التوقيت

غيّر `TIMEZONE` في `.env` ثم أعد تشغيل البوت، مثلاً:

```env
TIMEZONE=Europe/London
```

هذا يغيّر توقيت السجل والموعد المعروض فقط. ينتهي العد في **18 نوفمبر 2026، الساعة 22:00 UTC**.

### ملاحظات

- شغّل نسخة واحدة فقط واحتفظ بملف `gta_channel.json` بين مرات التشغيل.
- للاختبار: `npm test`.
- أُنشئ بمساعدة الذكاء الاصطناعي باستخدام **OpenAI Codex — GPT-6.1**.

---

## English

A Discord bot that creates a countdown channel and updates its name every 5 minutes.

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

### Change time zone

Change `TIMEZONE` in `.env`, then restart the bot. Example:

```env
TIMEZONE=Europe/London
```

This changes displayed times only. The countdown ends on **18 November 2026 at 22:00 UTC**.

### Notes

- Run one instance and keep `gta_channel.json` between restarts.
- Run tests: `npm test`.
- Created with AI assistance using **OpenAI Codex — GPT-6.1**.
