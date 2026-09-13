# Event Loop Lab

Інтерактивна лабораторія, де видно, як JavaScript насправді виконує ваш код.

**[Українська](#українська)** · [English](#english)

![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6) ![Vite](https://img.shields.io/badge/Vite-8-646CFF) ![acorn](https://img.shields.io/badge/acorn-8-8A4FFF) ![no framework](https://img.shields.io/badge/framework-none-6EE7A8)

---

## Українська

### Навіщо це

Event Loop зазвичай пояснюють схемою на дошці: ось стек, ось черга, ось стрілочки, все кудись от сюди гуляє.
Окрім очевидної нестачі візуалізації, такий підхід ще й ніяк не дає можливості скіки-хош разів покрутити це на власному коді.

Саме для цього і написана дана пісочниця. Тут ви пишете JavaScript, завантажуєте його в цикл і проганяєте **по одній атомарній дії за крок**. 

Стек викликів, черга microtask, черга task, таблиця Web API і heap оновлюються у вас на очах. Таймери, проміси, `fetch` та `async/await` підмінені видимими версіями самих себе, тож кожне додавання і зняття з черги можна понюхати, помацати, побачити і покрутити в різні боки.

Три речі, які пісочниця робить очевидними:

1. **Черга microtask спорожнюється повністю** перед наступною task. Навіть якщо
   microtask породить ще тисячу microtask, усі вони виконаються раніше за
   `setTimeout(fn, 0)`.
2. **`await` не блокує потік.** Кадр функції залишає стек, а призупинений стан
   лишається в heap. Потік у цей час **вільний**, а не заблокований.
3. **Порожні черги не означають зупинку.** Коли виконувати нічого, потік спить
   при 0% CPU, поки Web API не розбудить його.

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
> Він віддає описи повідомлень `{ key, params }`, а `ui` перекладає їх у момент відмальовування. Саме тому перемикання мови посеред виконання переназиває елементи, що вже стоять у чергах.

```
src/
  main.ts              головний скрипт файл, "вхідна точка"
  presets.ts           mock семи готових прикладів коду
  style.css            один файл, токени кольорів угорі

  i18n/
    en.ts              джерело істини для ключів
    uk.ts              Record<TranslationKey, string>, типізований за прикладом en.ts
    index.ts           Msg, Text, createTranslator()

  engine/              все що стосується рушія дублікату EventLoop-у на сторінці
    types.ts           
    world.ts           увесь мутабельний стан симуляції + createWorld()
    format.ts          хелпери показу значень і URL
    vm-promise.ts      VPromise: справжній стан, значення, черга реакцій
    async-driver.ts    проганяє переписану async-функцію, по одному await за раз
    web-apis.ts        таймери, fetch, rAF, queueMicrotask, console
    transform.ts       парсинг acorn, переписування async, мітки рядків
    loop.ts            сам цикл, генератор

  ui/
    dom.ts             кеш елементів і хелпери HTML
    render.ts          єдине місце, куди пишеться DOM
    controller.ts      load, step, play, до простою, edit, reset, мова
    preferences.ts     вибрана мова, та інші конфігурації
```

**`World` замість глобальних змінних.** Один обʼєкт тримає годинник, стек, обидві черги, таблицю Web API, heap і вивід.

**`createWorld()`** будує новий, тому Reset це один рядок, а не п'ятнадцять.

**Фабрики, привʼязані до світу.** `createPromiseClass(world)`, `createWebApis(world, VPromise)`, `createAsyncDriver(world, VPromise)`. Кожна замикає `world` один раз, тож виклики лишаються чистими і ніхто не тягнеться до глобальної змінної.

### Як це працює

- **Цикл це генератор.** Один `yield` на одну атомарну дію, і саме це робить можливою кнопку "Крок". Сам цикл лишається "тупим": він знімає елементи з масивів і викликає їх, ніколи не маючи навіть шансу дізнатись що таке Promise.

- **Проміси переписані, а не обгорнуті.** У `VPromise` є справжній стан, значення і черга реакцій. Поки він pending, видно, як росте лічильник реакцій; коли він врегульовується, видно, як черга очікування перетворюється на N microtask одразу.

- **`async`/`await` переписується до запуску.** acorn парсить код, кожна async-функція стає генератором, кожен `await` стає `yield` під керівництвом кастомного планувальника. Нативний `await` призупинявся б на черзі microtask справжнього рушія, якого пісочниця не бачить і не контролює. З переписуванням пауза справжня: кадр залишає стек, призупинений запис лишається в heap разом із локальними змінними, а замикання продовження чекає всередині проміса, який ви очікували.

- Оскільки це парсер, а не регулярка, переписування працює на всіх формах (оголошення, function expression, стрілкова з тілом і без, метод обʼєкта, top-level `await`), не чіпає слово `await` усередині рядків і коментарів, а мітки `__line(n)` для підсвітки потрапляють лише на справжні інструкції. Усе, що
переписати не вдається, трейситься з номером рядка.

- Коли всі черги порожні, цикл мотає віртуальний годинник до найближчого запису Web API замість того, щоб крутитися вхолосту. Це по суті `os.block_until_event()` зроблений видимим.

- Rejection, який ніхто не зловив, логується як `Uncaught (in promise) ...`, як у справжній консолі. Перевірка відбувається після спорожнення черги microtask, тому `.catch()`, доданий пізніше в тому ж проході, усе ще рахується.

### Робота з кодом

**"Завантажити в цикл"** - бере те, що в редакторі, і передає в чергу для виконання в цикл. 

**"Редагувати"** - повертає можливість редагування коду.

**"Скинути"** - повертає і відновлює обраний пресет, відкидаючи
правки.

Щойно в редакторі написане щось, чого немає в пресеті, список перемикається на **"Власний код"**. Коли обрано "Власний код", відновлювати нема чого, тож "Скинути" поводиться як "Редагувати".

### Свідомі спрощення

Це навчальна модель, а не реалізація специфікації. Тому допущені наступні спрощення:

- Крок рендеру йде після спорожнення microtask і перед "сном", тож колбек `requestAnimationFrame` спрацьовує раніше за `setTimeout(fn, 0)`. Справжній браузер привʼязує rAF до оновлення екрана і зазвичай виконує таймер першим.
- `async`-методи в класі це єдина фіча, яку не переписано. Вираз-обгортка не може стати на місце визначення методу. Завантаження трейситься з номером рядка.
- `fetch` підроблений з mock даними: `/users` повертає трьох заготовлених користувачів, `/dossier/<id>` - повертає один запис. А затримка - це хеш від URL, тож пресет завжди дає однаковий трейс.
- Годинник "стрибає", а не "цокає", тож `setInterval` іде рівно так швидко, як ви крокуєте. Він повторюється, доки хтось не викличе `clearInterval`, як і справжній.
- «До простою» зупиняється після 4000 дій, щоб вкладка не зависла.
- `.catch()`, доданий після перевірки на необроблені `rejection`, не скасує вже надрукований рядок. Справжній рушій викликав би `rejectionhandled`.

---

## English

### What This Exists

The Event Loop is usually explained with a blackboard diagram: here is the Stack, here is the Queue, here are the arrows moving everything around. Besides the obvious lack of visual feedback, this approach gives you zero opportunity to step through your own code as many times as you like.

That is precisely why this sandbox was built. Here, you write JavaScript, load it into the loop, and execute it **one atomic action per step**.

The Call Stack, Microtask Queue, Task Queue, Web API table, and Heap update right before your eyes. Timers, Promises, `fetch`, and `async/await` are replaced with fully observable versions of themselves, so every enqueue and dequeue operation can be inspected, felt, visualized, and manipulated from all angles.

Three key insights this sandbox makes clear:

1. **The Microtask Queue drains completely** before the next task. Even if a microtask spawns a thousand more microtasks, all of them will execute before `setTimeout(fn, 0)`.
2. **`await` does not block the thread.** The function frame leaves the call stack, while the suspended state remains in the Heap. The thread is **idle** during this time, not blocked.
3. **Empty queues do not mean execution has stopped.** When there is nothing to execute, the thread sleeps at 0% CPU utilization until a Web API wakes it up.

### How to Run

```sh
pnpm install
pnpm dev          # http://localhost:5173
pnpm typecheck    # tsc --noEmit
pnpm build        # typecheck + production build in dist
pnpm preview      # serve built dist
```

### Tech Stack

| Component | Purpose |
| --- | --- |
| TypeScript 6, `strict` | Types as documentation. `uk` is strictly typed against `en`, making any missing translation key a compile-time error |
| Vite 8 | Dev server and bundler. Zero plugins, seven-line config |
| acorn 8 + acorn-walk | **Runtime** JavaScript parser. It rewrites `async`/`await` prior to execution |
| pnpm | Package manager |
| Vanilla DOM, single CSS file | Framework-free, zero state libraries, zero CSS-in-JS |

Zero test dependencies: verification relies entirely on `typecheck`, builds, and preset validation in the browser. The total gzipped bundle size is around 48 KB, most of which is the parser itself.

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

**`World` instead of globals.** One object holds the clock, the stack, both queues, the Web API table, the heap and the output. `createWorld()` builds a fresh one, so Reset is a single line rather than fifteen.

**World-bound factories.** `createPromiseClass(world)`, `createWebApis(world, VPromise)`, `createAsyncDriver(world, VPromise)`. Each closes over `world` once, so call sites stay clean and nothing reaches for a global.

### How It Works

- **The loop is a generator.** Each `yield` corresponds to a single atomic action, which enables the "Step" control. The loop itself remains intentionally simple: it dequeues items from arrays and invokes them, having no internal concept of what a Promise is.

- **Promises are rewritten, not wrapped.** `VPromise` tracks actual state, value, and reaction queues. While pending, its reaction counter can be observed growing; when settled, the waiting queue is visibly transformed into N microtasks simultaneously.

- **`async`/`await` is transpiled prior to execution.** acorn parses the AST, transforming every async function into a generator and every `await` into a `yield` managed by a custom scheduler. A native `await` would suspend on the host engine's microtask queue, which the sandbox cannot inspect or control. With AST rewriting, suspension is fully explicit: the frame exits the stack, the suspended entry remains on the heap with its local scope, and the continuation closure waits inside the awaited promise.

- Because this uses an AST parser rather than regular expressions, the transformation handles all syntactic variants (declarations, function expressions, concise/block arrow functions, object methods, top-level `await`). It avoids matching `await` inside strings or comments, and inserts `__line(n)` execution markers strictly onto executable statements. Any unhandled constructs trigger a trace with line-number context.

- When all queues are exhausted, the loop advances the virtual clock directly to the nearest Web API scheduled time instead of spinning. This effectively visualizes an `os.block_until_event()` pattern.

- Unhandled rejections are logged as `Uncaught (in promise) ...`, mimicking standard browser console behavior. Evaluation occurs after the microtask queue has drained, allowing `.catch()` handlers added later within the same execution frame to register correctly.

### Workflow Controls

**"Load into loop"** - parses current editor content and enqueues it for event loop execution.

**"Edit"** - re-enables text editor focus for code modifications.

**"Reset"** - restores the currently selected preset, discarding local changes.

Modifying editor content away from a preset automatically updates the preset selector to **"Custom Code"**. When active, restore operations are disabled, making "Reset" function identically to "Edit".

### Intentional Simplifications

This project is an educational model rather than a spec-compliant runtime. As such, the following deliberate simplifications exist:

- Rendering steps execute immediately after microtask queue exhaustion and prior to idle states, causing `requestAnimationFrame` callbacks to fire before `setTimeout(fn, 0)`. Real browser engines tie rAF to frame refresh timing and typically process timer tasks first.
- Class `async` methods are currently excluded from AST rewriting, as wrapper expressions cannot cleanly replace method definitions. Loading these outputs a trace with line information.
- `fetch` uses mock data: `/users` returns three mocked user entities, while `/dossier/` returns a single record. Network latency is calculated via URL hashing to ensure deterministic traces across preset runs.
- The clock operates on discrete step increments rather than real-time ticks, so `setInterval` steps synchronously alongside user execution. It repeats until explicitly cleared via `clearInterval`, keeping native semantics.
- "Run to idle" enforces a hard cap at 4,000 operations to prevent browser tab lockup.
- Attaching `.catch()` after unhandled rejection evaluation will not retract previously emitted log lines, unlike engines supporting `rejectionhandled` events.
