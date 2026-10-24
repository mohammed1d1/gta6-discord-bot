# GTA 6 Discord Countdown | العد التنازلي للعبة GTA 6

> **AI disclosure:** This repository was created with AI assistance using **OpenAI Codex — GPT-6.1**.
>
> **توضيح استخدام الذكاء الاصطناعي:** أُنشئ هذا المستودع بمساعدة الذكاء الاصطناعي باستخدام **OpenAI Codex — GPT-6.1**.

A Node.js / discord.js v14 bot that creates a locked voice channel and updates its name every five minutes. Includes persistent storage, administrator-only setup, Arabic replies, and a configurable time zone (default: `UTC`).

بوت باستخدام Node.js وdiscord.js v14 ينشئ قناة صوتية مغلقة للاتصال الافتراضي، ويحدث اسمها كل خمس دقائق. يحفظ القناة بين مرات التشغيل، ويتيح الإعداد للمسؤولين فقط، مع ردود عربية وتوقيت قابل للتغيير (الافتراضي UTC).

## English

### Requirements and Discord setup

1. Install **Node.js 24.17.0 or newer** with npm. Check with `node --version` and `npm --version`.
2. Create an application in the [Discord Developer Portal](https://discord.com/developers/applications), open **Bot**, and obtain its bot token. Keep it secret.
3. Under **OAuth2 → URL Generator**, select `bot` and `applications.commands`. Select **View Channels**, **Connect**, and **Manage Channels**. Open the generated URL and invite the bot to your server. The bot does not need Administrator or privileged intents; only the `Guilds` intent is enabled. The initial permission overwrites are sent with the [channel creation request](https://docs.discord.com/developers/resources/guild#create-guild-channel).
4. Run one bot process per token and storage file. Use a persistent, writable directory; do not put the JSON file on an ephemeral filesystem.

### Clone, install, configure, run

Replace `YOUR_USERNAME` and `YOUR_REPOSITORY` below with your actual GitHub names:

```sh
git clone https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git
cd YOUR_REPOSITORY
npm ci
```

Create the environment file on macOS/Linux:

```sh
cp .env.example .env
```

Or in Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Edit `.env` locally:

```dotenv
DISCORD_TOKEN=your_bot_token_here
TIMEZONE=UTC
```

Replace the placeholder with the token from the Developer Portal. A hosting provider can inject `DISCORD_TOKEN` directly instead. Environment variables take precedence over `.env`. Never paste a real token into source code, commits, screenshots, or support messages.

To change the time zone, edit `TIMEZONE` in `.env`, for example `TIMEZONE=Europe/London` or `TIMEZONE=America/New_York`, then restart the bot. Use a valid IANA time zone name; daylight saving changes are handled automatically. Missing or blank values use `UTC`; invalid names stop startup with `INVALID_TIMEZONE`. This changes log timestamps and the release time displayed in the setup reply. The countdown duration and fixed release instant stay the same. Hosting environment variables override `.env`, so update the hosting setting too if one exists.

```sh
npm run check
npm test
npm start
```

As a server administrator, run `/setup_gta`. The bot registers this global command automatically when ready; Discord clients may need time to show it. The response is private. Repeating the command reuses the saved channel. If it was deleted, setup creates a replacement.

### Countdown and operations

- Fixed countdown target: **18 November 2026 at 22:00 UTC**, encoded as `2026-11-18T22:00:00Z`. This is a configured target, not a live release-date feed. Change `RELEASE_AT` in `index.js` if needed.
- Name: `⏳ GTA 6: {days}d {hours}h {minutes}m`; after the target: `🎉 GTA 6 نزلت!`. Whole remaining minutes are truncated, so the last partial minute shows `0m` until release.
- An interval runs every `5 * 60 * 1000` ms. Each cycle reads `gta_channel.json`, fetches channels afresh, and renames only changed names. Cycles cannot overlap. Rename attempts are spaced by at least five minutes after completion. The first scheduled update occurs five minutes after startup; delays or rate limits can make updates take longer. Release text appears on the next successful cycle, not necessarily at exactly midnight.
- Five minutes is the requested conservative cadence for the commonly observed two-renames-per-ten-minutes limit. Discord limits can change; discord.js handles REST rate-limit responses. Do not run multiple instances or use another process to rename these channels.
- Storage is a JSON object of `guildId: channelId` strings. Writes are serialized and replace the file atomically. Corrupt or unreadable data is preserved and reported, not reset silently. Confirmed deleted channels are removed from the mapping; temporary errors retain it. Back up this file privately. If it becomes corrupt, stop the bot and restore a valid backup before restarting.
- New channel creation is rolled back if saving fails. If rollback also fails, the log identifies the orphaned channel for manual deletion. A host crash between Discord creation and local persistence can also leave an orphan; inspect channels before repeating setup after a crash.
- `@everyone` can view the channel but cannot connect. The bot has View Channel, Connect, and Manage Channels. Administrators bypass channel denies; explicit role/member overwrites added later can also permit access. This is a display channel, not a universal administrator lockout.
- Creation requests `position: 0` without a parent category. Discord's client grouping and sorting rules determine its exact visual placement relative to text channels and categories.
- Keep the machine clock synchronized. Logs use `TIMEZONE` (default `UTC`), regardless of the host timezone. `Ctrl+C` / `SIGTERM` stops scheduling and allows pending work up to 15 seconds to finish.
- Use your host's process supervisor to restart on failure. The bot requires a long-running process and an outbound connection to Discord. The local JSON design is for a single process, not a horizontally scaled or sharded deployment.

### Publish safely to a new GitHub repository

Create an **empty** repository on GitHub, without an initial README, license, or `.gitignore`. Run these commands **inside this bot directory**. Replace the two placeholders in the remote URL. These commands create a local repository; do not run them from a parent folder containing other projects.

```sh
git init
git branch -M main
git add index.js package.json package-lock.json README.md .env.example .gitignore test
git status --short
git diff --cached
git diff --cached --name-only
```

Review the staged content. `.env`, `node_modules/`, and `gta_channel.json` must not be staged. The example contains only a placeholder. Then publish:

```sh
git commit -m "Add GTA 6 Discord countdown bot"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git
git push -u origin main
```

Commit `package-lock.json` for reproducible installs. `private: true` prevents accidental npm publication; it does not prevent publishing the GitHub repository. Choose a license before inviting reuse if desired. If a token was ever committed, **reset it immediately in the Discord Developer Portal**; `.gitignore` does not remove secrets from existing Git history.

### Troubleshooting and validation

- Missing command: confirm the bot is online, the scopes were selected, you have Administrator permission, and global command propagation has completed. Command registration failures exit with a nonzero status.
- Missing permissions: restore the bot's three required permissions and check channel overwrites. Missing access is not treated as channel deletion.
- Storage error: check directory write permissions and JSON validity; stop the process before repairing the file. Do not edit it while the bot runs.
- Tests use Node's built-in test runner and mocked Discord objects. They cover release boundaries, persistent storage, permissions, setup concurrency, rollback, missing channels, and update throttling. They do not contact a live Discord server. Before deployment, invite to a test server, run setup twice, verify permissions and channel position, observe an update, and restart to confirm persistence.

## العربية

### المتطلبات وإعداد تطبيق Discord

1. ثبّت **Node.js بالإصدار 24.17.0 أو أحدث** مع npm. تحقق باستخدام `node --version` و`npm --version`.
2. أنشئ تطبيقاً من [بوابة مطوري Discord](https://discord.com/developers/applications)، وافتح صفحة **Bot** للحصول على التوكن. احتفظ به سرياً.
3. في **OAuth2 → URL Generator** اختر `bot` و`applications.commands`. امنح البوت **View Channels** و**Connect** و**Manage Channels**. تُرسل أذونات القناة ضمن طلب إنشائها. افتح رابط الدعوة وأضف البوت إلى سيرفرك. لا يحتاج البوت إلى Administrator أو إلى privileged intents.
4. شغّل نسخة واحدة فقط من البوت، في مجلد دائم وقابل للكتابة. ملف الحفظ المحلي غير مناسب لعدة نسخ متزامنة.

### استنساخ المشروع وتشغيله

استبدل `YOUR_USERNAME` و`YOUR_REPOSITORY` باسم حسابك ومستودعك:

```sh
git clone https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git
cd YOUR_REPOSITORY
npm ci
```

أنشئ ملف `.env` على macOS أو Linux:

```sh
cp .env.example .env
```

أو على Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

افتح `.env` محلياً واستبدل القيمة التجريبية بالتوكن الحقيقي:

```dotenv
DISCORD_TOKEN=your_bot_token_here
TIMEZONE=UTC
```

يمكنك بدلاً من ذلك تعيين `DISCORD_TOKEN` في إعدادات الاستضافة. متغير البيئة له الأولوية على ملف `.env`. لا تضع التوكن داخل الكود أو ترفعه إلى GitHub.

لتغيير التوقيت، عدّل `TIMEZONE` في `.env`، مثلاً `TIMEZONE=Europe/London` أو `TIMEZONE=America/New_York`، ثم أعد تشغيل البوت. استخدم اسم منطقة زمنية صالحاً بصيغة IANA؛ يُطبّق التوقيت الصيفي تلقائياً. القيمة الفارغة أو غير المحددة تستخدم `UTC`، والاسم غير الصحيح يوقف بدء التشغيل بالرمز `INVALID_TIMEZONE`. يتغير توقيت السجل وموعد الإطلاق المعروض في رد الإعداد، بينما تبقى مدة العد التنازلي ولحظة انتهائه نفسها. إذا عيّنت المتغير في الاستضافة، عدّله هناك أيضاً لأنه يتقدم على `.env`.

```sh
npm run check
npm test
npm start
```

نفّذ `/setup_gta` من حساب لديه صلاحية Administrator. يُسجّل الأمر عالمياً عند جاهزية البوت، وقد يحتاج بعض الوقت ليظهر في Discord. يصلك تأكيد خاص بالعربية. تكرار الأمر يستخدم القناة المحفوظة، وإذا حُذفت ينشئ قناة بديلة.

### سلوك البوت والتشغيل المستمر

- موعد انتهاء العد التنازلي: **18 نوفمبر 2026، الساعة 22:00 بالتوقيت العالمي UTC**، بصيغة `2026-11-18T22:00:00Z`. ليس هذا الموعد مرتبطاً بمصدر أخبار تلقائي؛ عدّل `RELEASE_AT` عند الحاجة.
- اسم القناة قبل الموعد: `⏳ GTA 6: {days}d {hours}h {minutes}m`، وبعده: `🎉 GTA 6 نزلت!`. تُعرض الدقائق الكاملة المتبقية، لذلك تظهر `0m` خلال الجزء الأخير من الدقيقة.
- يبدأ التحديث الدوري بعد خمس دقائق من التشغيل. تُقرأ القنوات من الملف وتُجلب من Discord، ويتغير الاسم فقط عند الحاجة. لا تتداخل الدورات، ويترك البوت خمس دقائق على الأقل بين محاولات التسمية بعد اكتمالها. قد تؤخر الشبكة أو قيود Discord التحديث؛ يظهر نص الإطلاق في أول دورة ناجحة بعد الموعد.
- الفاصل المطلوب محافظ بالنسبة للحد المتداول، وهو تغيير الاسم مرتين كل عشر دقائق. الحدود قد تتغير، ويتعامل discord.js مع استجابات تحديد المعدل. تجنب تشغيل أكثر من نسخة أو تعديل الأسماء آلياً من جهة أخرى.
- يحفظ `gta_channel.json` ربط معرّفات السيرفرات بالقنوات. تُكتب التغييرات بشكل متسلسل وباستبدال ذري للملف. لا يمسح البوت الملف التالف تلقائياً. احتفظ بنسخة احتياطية خاصة، وأوقف البوت قبل إصلاح الملف أو استعادته.
- إذا فشل الحفظ بعد إنشاء قناة، يحاول البوت حذف القناة الجديدة. إذا فشل الحذف، يطبع معرّفها لتنظيفها يدوياً. انقطاع الجهاز بين الإنشاء والحفظ قد يترك قناة غير مسجلة أيضاً؛ افحص السيرفر قبل إعادة الإعداد بعد الانقطاع.
- يستطيع `@everyone` رؤية القناة لكن الاتصال ممنوع افتراضياً. للبوت صلاحيات العرض والاتصال وإدارة القناة. يتجاوز المسؤولون منع الاتصال، وقد تسمح أذونات إضافية تُضاف لاحقاً لبعض الأدوار أو الأعضاء بالاتصال.
- يطلب البوت إنشاء القناة في الموضع `0` دون تصنيف، لكن ترتيبها المرئي النهائي يخضع لقواعد عرض القنوات والتصنيفات في Discord.
- يستخدم السجل قيمة `TIMEZONE` (الافتراضي `UTC`). حافظ على دقة ساعة الجهاز. يوقف `Ctrl+C` أو `SIGTERM` الجدولة ويسمح بإنهاء العمل الجاري خلال 15 ثانية. استخدم مدير عمليات في الاستضافة لإعادة التشغيل عند الفشل، مع تخزين دائم واتصال مستمر بالإنترنت.

### رفع المشروع بأمان إلى GitHub

أنشئ مستودعاً **فارغاً** على GitHub دون README أو ترخيص أو `.gitignore` تلقائي. نفّذ الأوامر التالية **من داخل مجلد البوت**، وليس من مجلد أب يحتوي مشاريع أخرى:

```sh
git init
git branch -M main
git add index.js package.json package-lock.json README.md .env.example .gitignore test
git status --short
git diff --cached
git diff --cached --name-only
```

راجع الملفات المرحلية وتأكد من عدم وجود `.env` أو `node_modules/` أو `gta_channel.json`. استبدل اسم المستخدم والمستودع في الرابط ثم نفّذ:

```sh
git commit -m "Add GTA 6 Discord countdown bot"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git
git push -u origin main
```

ارفع `package-lock.json` لتثبيت الإصدارات نفسها. يمنع `private: true` النشر غير المقصود إلى npm، ولا يمنع رفع المشروع إلى GitHub. يمكنك اختيار ترخيص قبل السماح بإعادة الاستخدام. إذا رُفع توكن سابقاً، **أعد تعيينه فوراً من بوابة المطورين**؛ إضافة `.gitignore` لا تزيل الأسرار من تاريخ Git.

### التحقق وحل المشكلات

- إذا لم يظهر الأمر، تحقق من اتصال البوت وصلاحيتك كمسؤول ونطاقات الدعوة، وانتظر انتشار الأمر العالمي. فشل تسجيل الأمر ينهي التشغيل برمز خطأ.
- إذا فشل إعداد القناة أو تحديثها، تحقق من صلاحيات البوت وأذونات القناة والسجل. لا يُفسّر فقدان الوصول على أنه حذف للقناة.
- إذا ظهر خطأ حفظ، تحقق من صلاحيات المجلد وصحة JSON. أوقف البوت قبل الإصلاح.
- تعمل الاختبارات بمحاكاة Discord دون الاتصال بسيرفر حقيقي. قبل النشر، جرّب الإعداد مرتين في سيرفر تجريبي، وافحص الأذونات والموضع، وانتظر تحديثاً، ثم أعد تشغيل البوت للتحقق من استعادة القناة.

## References | المراجع

- [discord.js documentation](https://discord.js.org/docs/packages/discord.js/14.27.0)
- [Discord application commands](https://docs.discord.com/developers/interactions/application-commands)
- [Discord channel API](https://docs.discord.com/developers/resources/channel)
- [Discord rate limits](https://docs.discord.com/developers/topics/rate-limits)

The implementation uses Discord's global command create/upsert endpoint through `REST` and `Routes.applicationCommands`, preserving any other commands on the application.

يستخدم التنفيذ نقطة إنشاء/تحديث الأمر العالمي عبر `REST` و`Routes.applicationCommands`، مع الحفاظ على أي أوامر أخرى في التطبيق.
