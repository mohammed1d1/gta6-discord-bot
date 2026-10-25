# GTA 6 Countdown Bot

بوت Discord ينشئ قناة للعد التنازلي ويحدّث اسمها كل 5 دقائق.
A Discord bot that creates a countdown channel and updates its name every 5 minutes.

## التشغيل | Setup

**المتطلبات / Requirements:** Node.js 24.17.0+ و / and npm.

1. أنشئ بوتاً من [Discord Developer Portal](https://discord.com/developers/applications).
   Create a bot in the Developer Portal.
2. ادعُه إلى سيرفرك بالنطاقين `bot` و`applications.commands` وصلاحيات **View Channels، Connect، Manage Channels**.
   Invite it with those scopes and permissions.
3. نزّل المشروع وثبّت الحزم / Clone and install:

```sh
git clone https://github.com/mohammed1d1/gta6-discord-bot.git
cd gta6-discord-bot
npm ci
```

4. انسخ `.env.example` إلى ملف اسمه `.env`، ثم ضع توكن البوت:
   Copy `.env.example` to `.env` and enter your bot token:

```env
DISCORD_TOKEN=your_bot_token_here
TIMEZONE=UTC
```

**لا تشارك التوكن أو ترفع `.env` إلى GitHub. / Never share your token or upload `.env`.**

5. شغّل البوت / Start the bot:

```sh
npm start
```

6. داخل السيرفر، نفّذ `/setup_gta` بحساب لديه صلاحية **Administrator**.
   Run `/setup_gta` in your server as an administrator.

## تغيير التوقيت | Change time zone

غيّر `TIMEZONE` في `.env` ثم أعد تشغيل البوت، مثلاً:
Change `TIMEZONE` in `.env`, then restart the bot. Example:

```env
TIMEZONE=Europe/London
```

هذا يغيّر توقيت السجل والموعد المعروض فقط؛ موعد انتهاء العد ثابت: **18 نوفمبر 2026، الساعة 22:00 UTC**.
This changes displayed times only. The countdown ends on **18 November 2026 at 22:00 UTC**.

## ملاحظات | Notes

- شغّل نسخة واحدة فقط واحتفظ بملف `gta_channel.json` بين مرات التشغيل.
  Run one instance and keep `gta_channel.json` between restarts.
- للاختبار / Run tests: `npm test`.
- أُنشئ بمساعدة الذكاء الاصطناعي / Created with AI assistance: **OpenAI Codex — GPT-6.1**.
