# Chat exporter

Save your ChatGPT, Claude, and Venice chats in one go, to a file on your own device, and bring them to [Morse](https://trymorse.ai).

Each app has a script of its own. Run it on the site you're leaving, and it reads only that site.

| Script | Run it on | Steps |
| --- | --- | --- |
| [`chatgpt-exporter.js`](chatgpt-exporter.js) | chatgpt.com, on a computer | [trymorse.ai/import#chatgpt](https://trymorse.ai/import#chatgpt) |
| [`claude-exporter.js`](claude-exporter.js) | claude.ai, on a computer | [trymorse.ai/import#claude](https://trymorse.ai/import#claude) |
| [`venice-exporter.js`](venice-exporter.js) | venice.ai, on a computer or a phone | [trymorse.ai/import#venice](https://trymorse.ai/import#venice) |

Each file here is the exact file trymorse.ai serves under the same name (for example https://trymorse.ai/chatgpt-exporter.js), and the script behind that app's Export for Morse bookmark on [trymorse.ai/import](https://trymorse.ai/import).

## What every exporter does

- It runs only in your browser, on the site you're leaving, with your own signed-in session.
- It only reads. It never changes or deletes anything on your account.
- The file is built in your browser and saved as a download. Nothing is sent to Morse, and you don't need a Morse account to save it.
- Stop saves what's done so far.
- If something goes wrong, or something's missing from the file, Copy a report puts a short report on your clipboard for you to send us. It holds what the exporter's panel said, when, and your browser's name, never a chat, a name, or a file.
- A long history fills more than one file. Each file stands on its own, and Morse's import takes them together.

## ChatGPT

**What it saves:** every chat, archived ones and each project's too, along the branch you left it on, with every message, the replies you regenerated, and the messages you edited. The pictures and files you uploaded, and the pictures, charts, and documents ChatGPT made. Your projects with their names, instructions, and files, your custom instructions, what ChatGPT remembers, and the pictures in your library.

**Who it talks to:** chatgpt.com, and the addresses chatgpt.com gives it for your files. It reads your data the way the site itself does, with your session's sign-in token, which it sends to chatgpt.com alone and never puts in the file.

**How it paces itself:** ChatGPT only lets a page read chats so fast. The exporter reads one chat at a time, a beat apart, and waits longer whenever ChatGPT says to. On a long history it reads your newest chats first. If ChatGPT slows it down for good, it saves what it has and says so: run it again later and it goes on from there.

**Going on:** a run that's cut short keeps the ids of the chats it saved in chatgpt.com's own storage in your browser, and nothing else of yours. The next run there offers to go on, and saves only the rest, as a file of its own. Once a run has saved everything, it forgets them.

**What stays behind:** Temporary chats, which ChatGPT doesn't keep, and files ChatGPT no longer has, such as some uploads from long ago. Your Codex tasks and the files in your ChatGPT library come in ChatGPT's own export (Settings, then Data controls, then Export data), which Morse's import takes together with this file.

## Claude

**What it saves:** every chat and its dates, in the project it was in, your projects' threads too, with the replies you retried and the messages you edited, and the pages Claude cited. The pictures, PDFs, and other files you uploaded, and the documents, slides, and files Claude made for you. Your pins, which chats you archived, your custom instructions, your styles, what Claude remembers, your projects with their instructions, documents, and PDFs, what your scheduled tasks ask and what they replied, and your Code sessions in the cloud.

**Who it talks to:** claude.ai alone, with your own session.

**On a phone:** claude.ai's script policy keeps a bookmark from loading a script, so there's no phone bookmark. Use a computer.

**What stays behind:** the words of documents synced from other apps (their names come), Code sessions on your own computer, which were never on Claude's site, and the sound of voice chats, which Claude doesn't keep (their words come). Claude Design's chats and the artifacts you published come in Claude's own export (Settings, then Privacy, then Export data), which Morse's import takes together with this file.

## Venice

**What it saves:** every Classic and Agentic chat saved in the browser you run it in, your folders, your characters with their chats, pictures, and what Venice remembers for each, and the Minds you made. The pictures and videos Venice made, the files you attached, and each reply's thinking. Your Studio work, your notes and what Chat Insights learned about you, the documents you gave Venice's memory, the files in your Library and Movie Editor, your saved system prompts, your pinned messages, and your chat summaries.

**Who it talks to:** no server, for your data. Venice keeps your chats in your browser, and the exporter reads them there. Run on a page of venice.ai that isn't the chat app (its pricing, a blog post), it opens venice.ai's app out of sight in the same tab to read what it keeps.

**Only the signed-in account:** a browser keeps every account that's used it. The exporter saves only the account you're signed in to.

**What stays behind:** chats saved in another browser or on another device (run it there too), Temporary chats, which Venice said it wouldn't keep, Minds other people made (your chats with them come), pictures you upscaled, which Venice saved to your device, and how a Movie Editor project is cut together (its clips come).

## Check it yourself

The files trymorse.ai serves are these:

```sh
curl -s https://trymorse.ai/chatgpt-exporter.js | shasum -a 256
shasum -a 256 chatgpt-exporter.js

curl -s https://trymorse.ai/claude-exporter.js | shasum -a 256
shasum -a 256 claude-exporter.js

curl -s https://trymorse.ai/venice-exporter.js | shasum -a 256
shasum -a 256 venice-exporter.js
```

On a computer, the bookmark you drag to your bookmarks bar is the whole script without its comments, so what runs is what you saved, and it doesn't change unless you save it again. The script you can paste into your browser's console instead is the same. On a phone, Venice's bookmark loads https://trymorse.ai/venice-exporter.js each time it runs.

While it runs, your browser's developer tools (the Network tab) show every request it makes.

## License

MIT. See [LICENSE](LICENSE).

The exporters are made by Morse. They aren't made by, endorsed by, or affiliated with ChatGPT, Claude, or Venice, whose names are used only to say what they work with. Questions or problems: open an issue, or write to hello@trymorse.ai.
