# Event Loop Lab

Інтерактивна лабораторія, де видно, як JavaScript насправді виконує ваш код.

**[Українська](#українська)** · [English](#english)

![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6) ![Vite](https://img.shields.io/badge/Vite-8-646CFF) ![acorn](https://img.shields.io/badge/acorn-8-8A4FFF) ![no framework](https://img.shields.io/badge/framework-none-6EE7A8)

---

## Українська

### Навіщо це

Event Loop зазвичай пояснюють схемою на дошці: ось стек, ось черга, ось стрілочки.
Схема не бреше, але й не показує головного: **у якому саме порядку** і **в який
момент** усе це відбувається з вашим власним кодом.

Тут ви пишете JavaScript, завантажуєте його в цикл і проганяєте **по одній
атомарній дії за крок**. Стек викликів, черга microtask, черга task, таблиця
Web API і heap оновлюються у вас на очах. Таймери, проміси та `fetch` підмінені
видимими версіями самих себе, тож кожне додавання і зняття з черги можна
показати пальцем.

Три речі, які найчастіше розуміють неправильно і які лабораторія робить
очевидними:

1. **Черга microtask спорожнюється повністю** перед наступною task. Навіть якщо
   microtask породить ще тисячу microtask, усі вони виконаються раніше за
   `setTimeout(fn, 0)`.
2. **`await` не блокує потік.** Кадр функції залишає стек, а призупинений стан
   лишається в heap. Потік у цей час **вільний**, а не заблокований.
3. **Порожні черги не означають зупинку.** Коли виконувати нічого, потік спить
   при 0% CPU, поки Web API не розбудить його. Це не spin loop.

Дві мови інтерфейсу, українська за замовчуванням. Вибір зберігається в
localStorage, а перемикання **не перезапускає цикл**: воно переназиває навіть ті
елементи, що вже лежать у чергах.

### Як запустити

```sh
pnpm install
pnpm dev          # http://localhost:5173
pnpm typecheck    # tsc --noEmit
pnpm build        # typecheck + продакшн-збірка в dist
pnpm preview      # віддати зібраний dist
```

### Стек

| Що | Навіщо |
| --- | --- |
| TypeScript 6, `strict` | Типи як документація. `uk` типізований проти `en`, тож забутий ключ перекладу це помилка збірки |
| Vite 8 | Дев-сервер і збірка. Без плагінів, конфіг на сім рядків |
| acorn 8 + acorn-walk | Парсер JavaScript **у рантаймі**. Саме він переписує `async`/`await` перед запуском |
| pnpm | Менеджер пакетів |
| Vanilla DOM, один CSS | Без фреймворку, без state-бібліотеки, без CSS-in-JS |

Жодної залежності для тестів: перевірка це `typecheck`, збірка і проходження
пресетів у браузері. Бандл близько 48 KB gzip, з яких більшість це парсер.

### Архітектура

Головне правило одне, і з нього випливає все інше:

> **`engine` ніколи не імпортує `ui` і не знає про DOM.**
> Він віддає описи повідомлень `{ key, params }`, а `ui` перекладає їх у момент
> відмальовування. Саме тому перемикання мови посеред виконання переназиває
> елементи, що вже стоять у чергах.

```
src/
  main.ts              точка складання: css, кеш елементів, контролер
  presets.ts           сім готових прикладів
  style.css            один файл, токени кольорів угорі

  i18n/
    en.ts              джерело істини для ключів
    uk.ts              Record<TranslationKey, string>, типізований проти en.ts
    index.ts           Msg, Text, createTranslator()

  engine/              без DOM, без рядків перекладу, без імпортів з ui
    types.ts           форми, які відмальовує ui
    world.ts           увесь мутабельний стан симуляції + createWorld()
    format.ts          чисті хелпери показу значень і URL
    vm-promise.ts      VPromise: справжній стан, значення, черга реакцій
    async-driver.ts    проганяє переписану async-функцію, по одному await
    web-apis.ts        таймери, fetch, rAF, queueMicrotask, console
    transform.ts       парсинг acorn, переписування async, мітки рядків
    loop.ts            сам цикл, генератор

  ui/
    dom.ts             кеш елементів і хелпери HTML
    render.ts          єдине місце, куди пишеться DOM
    controller.ts      load, step, play, до простою, edit, reset, мова
    preferences.ts     запамʼятана мова, із захистом від вимкненого сховища
```

**`World` замість глобальних змінних.** Один обʼєкт тримає годинник, стек, обидві
черги, таблицю Web API, heap і вивід. `createWorld()` будує новий, тому Reset це
один рядок, а не п'ятнадцять.

**Фабрики, привʼязані до світу.** `createPromiseClass(world)`,
`createWebApis(world, VPromise)`, `createAsyncDriver(world, VPromise)`. Кожна
замикає `world` один раз, тож виклики лишаються чистими і ніхто не тягнеться до
глобальної змінної.

### Як це працює

**Цикл це генератор.** Один `yield` на одну атомарну дію, і саме це робить
можливою кнопку Крок. Сам цикл лишається дурним: він знімає елементи з масивів і
викликає їх, і ніколи не дізнається, що таке проміс.

**Проміси переписані, а не обгорнуті.** У `VPromise` є справжній стан, значення і
черга реакцій. Поки він pending, видно, як росте лічильник реакцій; коли він
врегульовується, видно, як черга очікування перетворюється на N microtask одразу.

**`async`/`await` переписується до запуску.** Код парситься acorn, кожна
async-функція стає генератором, кожен `await` стає `yield` під керуванням нашого
власного планувальника. Рідний `await` призупинявся б на черзі microtask
справжнього рушія, якої лабораторія не бачить і не може крокувати, тож пауза була
б переказана, а не показана. З переписуванням пауза справжня: кадр залишає стек,
призупинений запис лишається в heap разом із локальними змінними, а замикання
продовження чекає всередині проміса, який ви очікували.

Оскільки це парсер, а не регулярка, переписування працює на всіх формах
(оголошення, function expression, стрілкова з тілом і без, метод обʼєкта,
top-level `await`), не чіпає слово `await` усередині рядків і коментарів, а мітки
`__line(n)` для підсвітки потрапляють лише на справжні інструкції. Усе, що
переписати не вдається, повідомляється з номером рядка, а не падає мовчки.

Коли всі черги порожні, цикл перескакує віртуальний годинник до найближчого
запису Web API замість того, щоб крутитися вхолосту. Це `os.block_until_event()`
зроблений видимим. Простій це не блокування, і саме це показує пресет
«Потік вільний під час fetch»: таймер на 50мс виконує свій колбек на головному
потоці, поки запит на 342мс усе ще лежить у панелі Web API.

Rejection, який ніхто не зловив, друкується як `Uncaught (in promise) ...`, як у
справжній консолі. Перевірка відбувається після спорожнення черги microtask, тому
`.catch()`, доданий пізніше в тому ж проході, усе ще рахується.

### Робота з кодом

Load бере те, що в редакторі. **Редагувати** повертає до текстового поля,
зберігаючи ваш код. **Скинути** повертає і відновлює обраний пресет, відкидаючи
правки.

Щойно ви напишете щось, чого немає в пресеті, список перемикається на
**Власний код**, а скасування правок повертає назву пресета. Коли обрано власний
код, відновлювати нема чого, тож Скинути поводиться як Редагувати.

### Свідомі спрощення

Це навчальна модель, а не реалізація специфікації. Варто знати, перш ніж
посилатися на неї в суперечці:

- Крок рендеру йде після спорожнення microtask і перед сном, тож колбек
  `requestAnimationFrame` спрацьовує раніше за `setTimeout(fn, 0)`. Справжній
  браузер привʼязує rAF до оновлення екрана і зазвичай виконує таймер першим.
- `async`-методи в класі це єдина форма, яку не переписано. Обгортка-вираз не
  може стати на місце визначення методу. Завантаження такого коду повідомляє
  номер рядка і зупиняється.
- `fetch` підроблений: `/users` повертає трьох користувачів, `/dossier/<id>`
  один запис, а затримка це хеш від URL, тож пресет завжди дає однаковий трейс.
- Годинник стрибає, а не цокає, тож `setInterval` іде рівно так швидко, як ви
  крокуєте. Він повторюється, доки хтось не викличе `clearInterval`, як і
  справжній; «До простою» зупиняється після 4000 дій, щоб вкладка не зависла.
- `.catch()`, доданий після перевірки на необроблені rejection, не скасує вже
  надрукований рядок. Справжній рушій викликав би `rejectionhandled`.

### Публікація

Збірка статична і самодостатня, а `vite.config.ts` ставить `base: './'`, тож
`dist` працює з будь-якого шляху.

| Спосіб | Як |
| --- | --- |
| Netlify Drop | `pnpm build`, перетягнути `dist` на app.netlify.com/drop |
| GitHub Pages | запушити репозиторій, Settings, Pages, збірка з Actions або публікація `dist` |
| Cloudflare Pages | підключити репозиторій, збірка `pnpm build`, вихід `dist` |
| surge.sh | `pnpm build && npx surge dist` |

Шрифти тягнуться з Google Fonts. На будь-якому реальному хостингу все гаразд;
якщо відкрити зібраний файл без мережі, підставляться системні шрифти, і це
змінить вигляд, але не розкладку.

---

## English

### Why this exists

The event loop is usually explained with a whiteboard diagram: here is the stack,
here is the queue, here are the arrows. The diagram is not wrong, but it hides the
part that matters: **in what order** and **at what moment** any of it happens to
your own code.

Here you write JavaScript, load it into the loop, and step **one atomic action at
a time**. The call stack, microtask queue, task queue, Web API table and heap
update in front of you. Timers, promises and `fetch` are replaced with visible
versions of themselves, so every push and pop is something you can point at.

The three things people most often get wrong, made obvious:

1. **The microtask queue drains completely** before the next task. Even if a
   microtask queues a thousand more, all of them run before `setTimeout(fn, 0)`.
2. **`await` does not block the thread.** The frame leaves the stack and the
   paused state stays on the heap. The thread is **free**, not blocked.
3. **Empty queues do not mean a halt.** With nothing to run the thread sleeps at
   0% CPU until a Web API wakes it. It is not a spin loop.

Two interface languages, Ukrainian by default. The choice is kept in localStorage
and switching **does not restart the loop**: it relabels even the items already
sitting in the queues.

### Running it

```sh
pnpm install
pnpm dev          # http://localhost:5173
pnpm typecheck    # tsc --noEmit
pnpm build        # typecheck + production bundle into dist
pnpm preview      # serve the built dist
```

### Stack

| What | Why |
| --- | --- |
| TypeScript 6, `strict` | Types as documentation. `uk` is typed against `en`, so a missing translation key is a build error |
| Vite 8 | Dev server and build. No plugins, a seven-line config |
| acorn 8 + acorn-walk | A JavaScript parser **at runtime**. It is what rewrites `async`/`await` before the code runs |
| pnpm | Package manager |
| Vanilla DOM, one CSS file | No framework, no state library, no CSS-in-JS |

No test dependency: verification is `typecheck`, the build, and stepping the
presets in a browser. The bundle is about 48 KB gzip, most of it the parser.

### Architecture

One rule carries the rest:

> **`engine` never imports `ui` and knows nothing about the DOM.**
> It emits `{ key, params }` message descriptors and `ui` translates them at
> paint time. That is why switching language mid-run relabels items already
> sitting in the queues.

```
src/
  main.ts              composition root: css, element cache, controller
  presets.ts           seven worked examples
  style.css            one file, colour tokens at the top

  i18n/
    en.ts              source of truth for the keys
    uk.ts              Record<TranslationKey, string>, typed against en.ts
    index.ts           Msg, Text, createTranslator()

  engine/              no DOM, no translated strings, no imports from ui
    types.ts           the shapes ui renders
    world.ts           all mutable simulation state, plus createWorld()
    format.ts          pure value and URL display helpers
    vm-promise.ts      VPromise: real state, value, reaction queue
    async-driver.ts    drives a rewritten async function, one await at a time
    web-apis.ts        timers, fetch, rAF, queueMicrotask, console
    transform.ts       acorn parse, the async rewrite, line markers
    loop.ts            the loop itself, a generator

  ui/
    dom.ts             element cache and HTML helpers
    render.ts          the only place the DOM is written
    controller.ts      load, step, play, run to idle, edit, reset, language
    preferences.ts     the remembered language, guarded against blocked storage
```

**`World` instead of globals.** One object holds the clock, the stack, both
queues, the Web API table, the heap and the output. `createWorld()` builds a
fresh one, so Reset is a single line rather than fifteen.

**World-bound factories.** `createPromiseClass(world)`,
`createWebApis(world, VPromise)`, `createAsyncDriver(world, VPromise)`. Each
closes over `world` once, so call sites stay clean and nothing reaches for a
global.

### How it works

**The loop is a generator.** One `yield` per atomic action is what makes the Step
button possible. The loop itself stays dumb: it shifts things out of arrays and
calls them, and never learns what a promise is.

**Promises are reimplemented, not wrapped.** `VPromise` has real state, value and
a waiting room of reactions. While it is pending you watch the reaction count
climb; when it settles you watch the waiting room become N microtasks at once.

**`async`/`await` is rewritten before it runs.** The source is parsed with acorn,
every async function becomes a generator, and every `await` becomes a `yield`
driven by our own scheduler. Native `await` would suspend on the real engine's
microtask queue, which this lab cannot see or step, so the pause would be narrated
rather than shown. With the rewrite the pause is real: the frame leaves the call
stack, a paused record stays on the heap with its locals, and a resume closure
parks inside the awaited promise.

Because it is a parser and not a regex, the rewrite works on every async form
(declaration, function expression, arrow with a block or a concise body, object
method, top-level `await`), it leaves the word `await` alone inside strings and
comments, and the `__line(n)` markers that drive highlighting land on real
statements only. Anything it cannot handle is reported on the offending line
instead of failing quietly.

When every queue is empty the loop jumps the virtual clock forward to the next
pending Web API entry instead of spinning. That is `os.block_until_event()` made
visible. Idle is not the same as blocked, which is what the "thread is free
during a fetch" preset shows: a 50ms timer runs its callback on the main thread
while a 342ms request is still sitting in the Web API panel.

A rejection nobody caught is printed as `Uncaught (in promise) ...`, the way a
real console does. The sweep runs once the microtask queue drains, so a `.catch()`
attached later in the same pass still counts.

### Working with code

Load commits what is in the editor. **Edit** goes back to the textarea keeping
your code. **Reset** goes back and restores the selected preset, discarding edits.

Typing anything a preset does not say switches the dropdown to **Your own code**,
and undoing back to the original text switches it back. With your own code
selected there is nothing to restore, so Reset behaves like Edit.

### Deliberate simplifications

It is a teaching model, not a spec implementation. Worth knowing before you use it
to settle an argument:

- The render step runs after the microtask drain and before the loop sleeps, so a
  `requestAnimationFrame` callback fires ahead of a `setTimeout(fn, 0)`. A real
  browser ties rAF to the display refresh and usually runs the timer first.
- `async` methods on a class are the one form not rewritten. An expression wrapper
  cannot stand in for a method definition. Loading one reports the line and stops.
- `fetch` is mocked: `/users` returns three users, `/dossier/<id>` returns one
  record, and latency is a hash of the URL so a preset always traces the same.
- The clock jumps rather than ticks, so a `setInterval` runs as fast as you step
  it. It repeats until something calls `clearInterval`, exactly like the real
  thing; Run to idle stops after 4000 actions so a runaway loop cannot hang the tab.
- A `.catch()` attached after the unhandled-rejection sweep does not retract an
  already-printed line. A real engine would fire `rejectionhandled`.

### Publishing

The build is static and self-contained, and `vite.config.ts` sets `base: './'` so
`dist` works from any path.

| Route | How |
| --- | --- |
| Netlify Drop | `pnpm build`, drag `dist` onto app.netlify.com/drop |
| GitHub Pages | push the repo, Settings, Pages, build from Actions or publish `dist` |
| Cloudflare Pages | connect the repo, build `pnpm build`, output `dist` |
| surge.sh | `pnpm build && npx surge dist` |

Fonts load from Google Fonts. Any real host is fine; opening the built file
offline falls back to system fonts, which changes the look but not the layout.
