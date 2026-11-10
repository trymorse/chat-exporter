// Morse's exporter for venice.ai, apart from the character apps' (exporter/cai-exporter.js). Run
// there from a bookmark or the console, it saves what's in the browser as JSON Morse's import
// reads (`morse.venice-export`, readers/venice.ts), in files that each stand alone, changing nothing.
//
// The site keeps an account's data only in its browsers: Classic in `venice-db-encrypted` (`__veniceDb`),
// Agentic chats, Minds, and memories in `venice-rx-db-encrypted`, media in OPFS `media/`. A Temporary
// chat is left out, as the site promises. Plain and self-contained, as a `javascript:` bookmark runs it.
(() => {
	if (window.__morseVenice?.running) return;
	window.__morseVenice?.close();
	if (!/(^|\.)venice\.ai$/.test(location.hostname)) {
		alert("Open Venice in this tab, then run the Morse exporter again.");
		return;
	}

	const MINDS = "venice-rx-db-encrypted";
	const CLASSIC = "venice-db-encrypted";
	/** Where Morse's import is, for the button that ends a run. */
	const MORSE = "https://trymorse.ai/chat?import=open";
	/** Where a report of a run that went wrong goes. */
	const HELP = "hello@trymorse.ai";
	/** How long, a quarter second at a time, the app has to open out of sight. */
	const APP_WAITS = 80;
	/** The longest side of a picture in the file: the import draws it no larger. */
	const PICTURE = 1600;
	/** A video or sound larger than this stays out: the file is read whole. */
	const MAX_MEDIA = 96 * 1024 * 1024;
	/** What a file may hold of pictures, videos, and sound, in characters: past that, one too long to
	 * read back whole would lose every chat in it. */
	const ROOM = 320 * 1024 * 1024;
	/** With less than this left, what comes next goes in a new file: the largest video this can hold. */
	const LOW = (MAX_MEDIA * 4) / 3 + 1024;
	let room = ROOM;
	/** Files named and not saved, for the panel to say. */
	let left = 0;
	/** Classic chats still encrypted where this could only read them as stored, for the panel. */
	let locked = 0;
	/** Messages of a shape this couldn't read, left out, for the panel to say. */
	let odd = 0;
	let stopped = false;
	/** What's been saved, for the panel to say. */
	const total = { files: 0, chats: 0, messages: 0 };
	/** The file being filled, once there is one. */
	let current = null;
	/** What the media read since the last thing put in the file comes to: the chat being read holds
	 * it, and it goes in whichever file that chat does. */
	let held = 0;
	/** Puts `item` in the file's `list`, and with it what it held. Read `item` first: a save while
	 * reading it gives the file new lists, and the one named before would be the saved file's. */
	const put = (list, item) => {
		list.push(item);
		held = 0;
		// A chat's words take room too, which a long history's do.
		if (item.messages) room -= wordsIn(item);
	};

	/** A chat's messages, each of `list` read by `read`: one that can't be is left out and counted,
	 * so an odd row costs itself and not the chats after it. */
	async function readEach(list, read) {
		const out = [];
		for (const m of list)
			try {
				out.push(await read(m));
			} catch {
				odd++;
			}
		return out;
	}

	/** About what a chat's words come to in the file, its pictures aside. */
	function wordsIn(chat) {
		let n = 200;
		for (const m of chat.messages) {
			n += (m.content?.length ?? 0) + (m.reasoning?.length ?? 0) + 60;
			for (const f of m.files ?? [])
				n += (f.text?.length ?? 0) + (f.html?.length ?? 0) + 40;
		}
		return n;
	}

	/** The names given the files that go in one project here, so no two are one: the first of a
	 * name keeps it, and each after it, oldest first, is "notes (2).md". */
	const taken = new Set();
	function nameOf(name) {
		if (!taken.has(name)) {
			taken.add(name);
			return name;
		}
		const [, stem, extension = ""] = /^(.*?)(\.[^.]*)?$/.exec(name);
		for (let n = 2; ; n++) {
			const next = `${stem} (${n})${extension}`;
			if (!taken.has(next)) {
				taken.add(next);
				return next;
			}
		}
	}
	const oldest = (a, b) =>
		(a.createdAtUnixTimestamp ?? 0) - (b.createdAtUnixTimestamp ?? 0);

	// The panel: what it's doing, and Stop or Close.
	const panel = document.createElement("div");
	panel.setAttribute("role", "dialog");
	panel.setAttribute("aria-label", "Export for Morse");
	panel.tabIndex = -1;
	panel.style.cssText =
		"position:fixed;z-index:2147483647;right:16px;bottom:16px;width:360px;max-width:calc(100vw - 32px);" +
		"background:#fff;color:#111;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.35);" +
		"font:14px/1.45 system-ui,-apple-system,sans-serif;padding:16px 18px;box-sizing:border-box;";
	const title = document.createElement("div");
	title.style.cssText = "font-weight:600;font-size:15px;margin-bottom:6px;";
	title.textContent = "Saving your Venice data for Morse";
	const status = document.createElement("div");
	status.setAttribute("aria-live", "polite");
	const detail = document.createElement("div");
	detail.style.cssText = "color:#555;font-size:13px;margin-top:4px;";
	const buttons = document.createElement("div");
	buttons.style.cssText =
		"display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;margin-top:12px;";
	const button = (label) => {
		const b = document.createElement("button");
		b.type = "button";
		b.textContent = label;
		b.style.cssText =
			"border:0;border-radius:8px;padding:7px 12px;font:inherit;cursor:pointer;background:#111;color:#fff;";
		buttons.append(b);
		return b;
	};
	const stopButton = button("Stop and save");
	const saveButton = button("Save");
	// Where a run went wrong or left something out: what the panel says, to send us. One that went
	// well offers it quietly, a line under what the panel says.
	const reportButton = button("Copy a report");
	reportButton.style.background = "#ececec";
	reportButton.style.color = "#111";
	reportButton.style.display = "none";
	const quietReport = button("Something missing? Copy a report");
	quietReport.style.cssText =
		"border:0;background:none;padding:0;margin-top:8px;font:inherit;font-size:13px;color:#555;text-decoration:underline;cursor:pointer;text-align:left;";
	const closeButton = button("Close");
	for (const b of [saveButton, closeButton, quietReport])
		b.style.display = "none";
	// Once there's a file to bring: Morse's Import, in a tab of its own, for the file to be chosen.
	const openMorse = document.createElement("a");
	openMorse.textContent = "Open Morse";
	openMorse.href = MORSE;
	openMorse.target = "_blank";
	openMorse.rel = "noopener";
	openMorse.style.cssText =
		"border-radius:8px;padding:7px 12px;font:inherit;background:#111;color:#fff;text-decoration:none;";
	openMorse.style.display = "none";
	buttons.append(openMorse);
	const note = document.createElement("div");
	note.style.cssText = "color:#555;font-size:13px;margin-top:8px;";
	note.style.display = "none";
	panel.append(title, status, detail, quietReport, note, buttons);
	document.body.append(panel);
	panel.focus();
	const say = (what, more = "") => {
		status.textContent = what;
		detail.textContent = more;
	};
	const close = () => panel.remove();
	stopButton.onclick = () => {
		stopped = true;
		say("Stopping…");
	};
	closeButton.onclick = close;
	/** Whether the run went wrong, as no one could put right by signing in, for Copy a report. */
	let troubled = false;
	// What the panel says and where it ran: nothing of the chats.
	reportButton.onclick = quietReport.onclick = async () => {
		const report = [
			`Morse exporter on ${location.hostname}`,
			`When: ${new Date().toISOString()}`,
			`Browser: ${navigator.userAgent}`,
			`It said: ${status.textContent} ${detail.textContent}`,
		].join("\n");
		note.style.display = "";
		try {
			await navigator.clipboard.writeText(report);
			reportButton.textContent = "Copied";
			quietReport.style.display = "none";
			note.textContent = `Report copied. Paste it in an email to ${HELP}, and say what went wrong. It holds none of your chats, only what this says, when, and your browser.`;
		} catch {
			// Without the clipboard, the report to copy by hand.
			note.textContent = `Copy this and email it to ${HELP}:`;
			const area = document.createElement("textarea");
			area.value = report;
			area.readOnly = true;
			area.style.cssText =
				"display:block;width:100%;height:96px;margin-top:6px;font:12px/1.4 ui-monospace,monospace;";
			note.append(area);
			area.select?.();
		}
	};
	window.__morseVenice = { running: true, close };

	const pause = (ms) => new Promise((done) => setTimeout(done, ms));

	/** The app out of sight, where this page isn't it, once there is one. */
	let appFrame = null;

	/** The window with the site's app in it: this page, or on a page of the site that isn't the app (its
	 * database shut), the app opened out of sight. Without one, Classic chats can't be read. */
	async function theApp() {
		if (window.__veniceDb) return window;
		appFrame = document.createElement("iframe");
		appFrame.style.cssText =
			"position:fixed;left:-10px;top:-10px;width:1px;height:1px;opacity:0;border:0;pointer-events:none;";
		appFrame.src = "/chat/classic";
		document.body.append(appFrame);
		for (let i = 0; i < APP_WAITS && !stopped; i++) {
			const app = appFrame.contentWindow;
			if (app?.__veniceDb) return app;
			await pause(250);
		}
		appFrame.remove();
		appFrame = null;
		return window;
	}

	/** Who the file is for, by the account ids the page keeps: empty
	 * signed out, null where the page can't say. A browser keeps every account that's used it. */
	let owners = null;
	const ownerOf = (row) => row?.ownerId ?? row?.owner_id;
	const isSignedOutOwner = (owner) => /^user_anon/.test(String(owner));

	/** Whether the page says no one is signed in, not that it couldn't say. */
	const signedOut = () => owners?.size === 0;
	function belongs(row) {
		const owner = ownerOf(row);
		if (!owners || owner === undefined || owner === null) return true;
		return owners.size ? owners.has(owner) : isSignedOutOwner(owner);
	}

	async function signedIn(app) {
		// The app's database opens before it knows who's signed in.
		for (let i = 0; i < APP_WAITS && !app.Clerk?.loaded && !stopped; i++)
			await pause(250);
		if (!app.Clerk?.loaded) return;
		owners = new Set();
		const id = app.Clerk.user?.id;
		if (!id) return;
		owners.add(id);
		try {
			const kept = app.localStorage;
			for (const key of Object.keys(kept))
				if (/^ph_.*_posthog$/.test(key)) {
					const known = JSON.parse(kept.getItem(key))?.distinct_id;
					if (typeof known === "string" && !isSignedOutOwner(known))
						owners.add(known);
				}
		} catch {}
	}

	/** Its own id in the Agentic stores, where the page doesn't say it otherwise: the account
	 * that last chatted there. Known before anything's read by whose it is. */
	async function learnAgenticOwner() {
		if (owners?.size !== 1) return;
		const db = await opened(MINDS);
		if (!db) return;
		try {
			const latest = (
				await documents(db, /^mindConversations-\d+-documents$/, true)
			)
				.filter((c) => ownerOf(c) && !isSignedOutOwner(ownerOf(c)))
				.sort(
					(a, b) =>
						(b.updatedAtUnixTimestamp ?? 0) - (a.updatedAtUnixTimestamp ?? 0),
				)[0];
			if (latest) owners.add(ownerOf(latest));
		} finally {
			db.close();
		}
	}

	/** The folder at `path` under the browser's private files, or null. */
	async function folder(path) {
		try {
			let at = await window.navigator.storage.getDirectory();
			for (const part of path) at = await at.getDirectoryHandle(part);
			return at;
		} catch {
			return null;
		}
	}

	/** The file named `stem` in the folder `dir`, or null: one gone since the folder was listed is
	 * as good as none. */
	async function inFolder(dir, stem) {
		try {
			for await (const [name, handle] of dir.entries())
				if (handle.kind === "file" && name.startsWith(`${stem}.`))
					return await handle.getFile();
		} catch {
			return null;
		}
		return null;
	}

	/** The file named `stem` in `media/<place>` or its attachments, or null. */
	async function found(place, stem) {
		for (const path of [
			["media", place],
			["media", place, "attachments"],
		]) {
			const dir = await folder(path);
			const file = dir && (await inFolder(dir, stem));
			if (file) return file;
		}
		return null;
	}

	/** Every file of the browser's private files, by name, the first of each: for what names its file
	 * and not its folder. Read once, when first asked. */
	let named = null;
	async function byName(name) {
		if (!named) {
			named = new Map();
			const walk = async (dir) => {
				for await (const [n, handle] of dir.entries())
					if (handle.kind === "file") {
						if (!named.has(n)) named.set(n, handle);
					} else await walk(handle);
			};
			const root = await folder([]);
			if (root) await walk(root).catch(() => {});
		}
		return (
			named
				.get(name)
				?.getFile()
				.catch(() => null) ?? null
		);
	}

	/** The file named `stem` in the folder at `path`, or null. */
	async function foundIn(path, stem) {
		const dir = await folder(path);
		return dir ? inFolder(dir, stem) : null;
	}

	/** The file a row's path names: `<place>/<name>`, or `media/<place>/<name>`. */
	function foundAt(path) {
		if (typeof path !== "string") return null;
		const parts = path.split("/").filter((part) => part !== "media");
		const stem = parts.at(-1).replace(/\.[^.]+$/, "");
		return found(parts.at(-2), stem);
	}

	/** A picture made smaller for the file, or itself if it can't be. */
	async function smaller(file, side = PICTURE, quality = 0.85) {
		if (!file.type.startsWith("image/") || !window.createImageBitmap)
			return file;
		try {
			const bitmap = await window.createImageBitmap(file);
			const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
			const canvas = document.createElement("canvas");
			canvas.width = Math.round(bitmap.width * scale);
			canvas.height = Math.round(bitmap.height * scale);
			const paper = canvas.getContext("2d");
			paper.fillStyle = "#fff";
			paper.fillRect(0, 0, canvas.width, canvas.height);
			paper.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
			bitmap.close();
			return (
				(await new Promise((done) =>
					canvas.toBlob(done, "image/jpeg", quality),
				)) ?? file
			);
		} catch {
			return file;
		}
	}

	/** A file as a `data:` URL, or null, counted as left, when it isn't there or there's no room. */
	async function dataOf(file) {
		if (!file || file.size > MAX_MEDIA) {
			left++;
			return null;
		}
		const read = (blob) =>
			new Promise((done) => {
				const reader = new FileReader();
				reader.onload = () => done(reader.result);
				reader.onerror = () => done(null);
				reader.readAsDataURL(blob);
			});
		let url = await read(await smaller(file));
		// A chat's pictures past what this file has room for go in the next, the chats before saved.
		if (url && url.length > room && current) await save(current, true);
		// A chat with more than a file holds keeps the rest of its pictures smaller, where this browser
		// can draw them smaller.
		if (
			url &&
			url.length > room &&
			file.type.startsWith("image/") &&
			window.createImageBitmap
		)
			url = await read(await smaller(file, 640, 0.7));
		if (!url || url.length > room) {
			left++;
			return null;
		}
		room -= url.length;
		held += url.length;
		return url;
	}

	/** A file as the chat's file holds it: its bytes, or its name alone without them. */
	async function stored(name, file) {
		const data = await dataOf(file);
		return data ? { name, data } : { name };
	}

	/** Where `opfs-media:<place>|<stem>|<type>` says a file is. */
	const where = (address) =>
		/^opfs-media:([^|]+)\|([^|]+)\|/.exec(address ?? "")?.slice(1);

	/** What the user attached to a Classic message: the words the site read of a document, or the
	 * file. */
	async function attached(attachment) {
		const name = attachment.fileName ?? "File";
		if (typeof attachment.result === "string" && attachment.result)
			return { name, text: attachment.result };
		const at = where(attachment.resultMedia);
		return at ? stored(name, await found(...at)) : { name };
	}

	/** What an IndexedDB request comes to. */
	const answer = (asked) =>
		new Promise((done, failed) => {
			asked.onsuccess = () => done(asked.result);
			asked.onerror = () => failed(asked.error);
		});

	/** The browser's database `name`, open, or null when it has none of that name. */
	async function opened(name) {
		const known = await window.indexedDB?.databases?.();
		if (!known?.some((d) => d.name === name)) return null;
		return answer(window.indexedDB.open(name));
	}

	/** The Classic tables, read through the page's own database, else as stored. A table it lacks
	 * reads as empty, a row it can't read as none. */
	async function classicTables(app) {
		const page = app.__veniceDb;
		if (page)
			return {
				async all(name) {
					try {
						return (await page.table(name).toArray()).filter(belongs);
					} catch {
						return [];
					}
				},
				async everyones(name) {
					try {
						return await page.table(name).toArray();
					} catch {
						return [];
					}
				},
				async get(name, key) {
					try {
						return await page.table(name).get(key);
					} catch {
						return undefined;
					}
				},
				close() {},
			};
		const db = await opened(CLASSIC);
		if (!db) return null;
		const has = (name) => [...db.objectStoreNames].includes(name);
		const plain = (row) => (row && !row.__encryptedData ? row : undefined);
		return {
			async all(name) {
				if (!has(name)) return [];
				const rows = await answer(
					db.transaction(name).objectStore(name).getAll(),
				);
				if (name === "conversations")
					locked = rows.filter((r) => r.__encryptedData && belongs(r)).length;
				return rows.filter(plain).filter(belongs);
			},
			async everyones(name) {
				if (!has(name)) return [];
				return (
					await answer(db.transaction(name).objectStore(name).getAll())
				).filter(plain);
			},
			async get(name, key) {
				if (!has(name)) return undefined;
				return plain(
					await answer(db.transaction(name).objectStore(name).get(key)),
				);
			},
			close: () => db.close(),
		};
	}

	/** The picture type bytes say they are, or "" for another. */
	function typeOf(bytes) {
		const b = new Uint8Array(bytes.slice(0, 12));
		if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
		if (b[0] === 0x89 && b[1] === 0x50) return "image/png";
		if (b[0] === 0x47 && b[1] === 0x49) return "image/gif";
		if (b[8] === 0x57 && b[9] === 0x45) return "image/webp";
		return "";
	}

	/** A picture kept in a row rather than the files, its bytes as they are or in base64. */
	async function pictureOf(bytes) {
		if (!bytes) return null;
		if (typeof bytes === "string")
			bytes = Uint8Array.from(atob(bytes.replace(/^data:[^,]*,/, "")), (c) =>
				c.charCodeAt(0),
			).buffer;
		// From the app out of sight, a Blob of another window's is one all the same.
		if (typeof bytes.arrayBuffer === "function")
			bytes = await bytes.arrayBuffer();
		return new Blob([bytes], { type: typeOf(bytes) });
	}
	/** One an older version of the site kept in its database rather than its files: `messageImages`, by message. */
	const keptPicture = async (tables, messageId) =>
		pictureOf((await tables.get("messageImages", messageId))?.contentBinary);

	/** A Classic message. What a picture or video's row says is the prompt it was made from, which
	 * may be one the site wrote for itself: the file is the reply. */
	async function row(m, tables) {
		const out = {
			role: m.role,
			content: m.content ?? "",
			at: m.createdAtUnixTimestamp,
			...sourcesOf(m.references),
		};
		// An upscale goes to the user's downloads and isn't kept, and the site says so in its place.
		if (
			m.role === "assistant" &&
			m.modelType === "enhance-image" &&
			!m.fileName
		) {
			out.content = "Upscaled image has been downloaded to your device.";
			return out;
		}
		const made =
			m.role === "assistant" &&
			(m.fileName ||
				m.videoPath ||
				/image|video|upscale|inpaint|audio|music/.test(m.modelType ?? ""));
		if (made) {
			const type = m.fileType ?? "";
			const model = m.modelType ?? "";
			const video =
				type.startsWith("video/") || m.videoPath || /video/.test(model);
			const sound =
				!video && (type.startsWith("audio/") || /audio|music/.test(model));
			const path = m.fileName || m.videoPath || m.audioPath;
			let media = path ? await foundAt(path) : null;
			if (!media && !video && !sound) media = await keptPicture(tables, m.id);
			out.content = "";
			out.files = [
				await stored(video ? "Video" : sound ? "Sound" : "Picture", media),
			];
			return out;
		}
		if (m.role === "assistant" && m.reasoningContent)
			out.reasoning = m.reasoningContent;
		// A reply read aloud keeps its words, the sound beside them.
		if (m.role === "assistant" && m.audioPath)
			out.files = [await stored("Sound", await foundAt(m.audioPath))];
		if (m.role === "user" && m.attachments?.length) {
			out.files = [];
			for (const attachment of m.attachments)
				out.files.push(await attached(attachment));
		}
		return out;
	}

	/** Waits for the user to press Save: a browser asks before a page's second download, unless a
	 * click starts it. */
	function pressed(label) {
		stopButton.style.display = "none";
		saveButton.textContent = label;
		saveButton.style.display = "";
		return new Promise((done) => {
			saveButton.onclick = () => {
				saveButton.style.display = "none";
				stopButton.style.display = "";
				done();
			};
		});
	}

	/** A file's lists of what it alone holds, which a new file starts empty: unlike the characters and
	 * folders, every file repeats. */
	const OWN = [
		...["chats", "studio", "memories", "profiles", "documents"],
		...["uploads", "systemPrompts", "pinned", "summaries"],
	];

	/** Saves `file`, unless it holds only what every file repeats (`partway` through a chat), and empties
	 * it for what's next but the characters and folders, so any file can be imported alone. */
	async function save(file, partway = false) {
		file.chats = file.chats.filter((c) => c.messages.length);
		file.studio = file.studio.filter((s) => s.data);
		const holds = OWN.some((list) => file[list].length);
		if (!holds && !file.cast.length) return;
		// A later file that would hold only the characters and folders every file repeats isn't one.
		if ((total.files || partway) && !holds) return;
		const nth = total.files + 1;
		if (total.files) {
			say(`File ${nth} is ready.`, "Save it, and this goes on.");
			await pressed(`Save file ${nth}`);
		}
		const day = new Date().toISOString().slice(0, 10);
		const a = document.createElement("a");
		a.href = URL.createObjectURL(saved(file));
		a.download = `venice-export-${day}${total.files ? `-${nth}` : ""}.json`;
		document.body.append(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
		total.files = nth;
		total.chats += file.chats.length;
		total.messages += file.chats.reduce((n, c) => n + c.messages.length, 0);
		for (const list of OWN) file[list] = [];
		// What the chat still being read holds goes in the next file.
		room = ROOM - JSON.stringify(file.cast).length - held;
	}

	/** Goes on in a new file, when this one has too little room left for the next. */
	async function roomy(file) {
		if (room < LOW) await save(file);
	}

	const SESSION = /^(video|image|audio)-studio-gallery-/;

	/** `rows` by chat, as `chatOf` says each's chat is: a long history can't search for each chat's. */
	function byChat(rows, chatOf) {
		const chats = new Map();
		for (const m of rows) {
			const list = chats.get(chatOf(m));
			if (list) list.push(m);
			else chats.set(chatOf(m), [m]);
		}
		return chats;
	}

	/** Every memory but what's deleted, and Chat Insights, read before the chats, so a character's go with it into each file holding its chats. */
	async function remembering() {
		const db = await opened(MINDS);
		if (!db) return { remembered: [], profiles: [] };
		try {
			const remembered = await documents(db, /^memories-\d+-documents$/);
			const profiles = (
				await documents(db, /^entityInsights-\d+-documents$/)
			).filter((e) => e.entityType === "user");
			// What it noted of the two of them, not how it rates the user.
			for (const r of await documents(
				db,
				/^relationshipInsights-\d+-documents$/,
			)) {
				const { characterId, commonTasks, conflictHistory } = r;
				const { insideReferences, sharedTopics } = r;
				const noted = {
					commonTasks,
					conflictHistory,
					insideReferences,
					sharedTopics,
				};
				if (Object.values(noted).some((list) => list?.length))
					profiles.push({ characterId, ...noted });
			}
			return { remembered, profiles };
		} finally {
			db.close();
		}
	}

	/** A profile as the file keeps it: what it says, without its keys and times. */
	const said = ({ id, ownerId, entityType, characterId, ...rest }) =>
		Object.fromEntries(
			Object.entries(rest).filter(
				([key]) => !key.startsWith("_") && !/UnixTimestamp$/.test(key),
			),
		);

	/** The system prompts saved, Classic's and a later version's, the messages pinned, and the summaries
	 * of chats, each with its chat's name, which a file saved later may no longer hold. */
	async function kept(file, tables) {
		const db = await opened(MINDS);
		const later = db
			? await documents(db, /^userSystemPrompts-\d+-documents$/).finally(() =>
					db.close(),
				)
			: [];
		// Each once by id, a later copy over Classic's (edited since), then by words, on if any copy
		// is. Classic's settings may still hold the words the later copy replaced: those are it.
		const [byId, was] = [new Map(), new Map()];
		for (const p of [...(await tables.all("userSystemPrompts")), ...later]) {
			const [id, had] = [String(p.id ?? p.prompt), byId.get(String(p.id))];
			if (had?.prompt && p.prompt && had.prompt !== p.prompt)
				was.set(had.prompt, p.prompt);
			if (p.prompt) byId.set(id, p);
		}
		const on = new Set(
			(await tables.all("settings")).map(
				(s) => was.get(s.systemPrompt) ?? s.systemPrompt,
			),
		);
		const prompts = new Map();
		for (const p of byId.values())
			prompts.set(p.prompt, {
				name: p.friendlyName ?? p.name,
				prompt: p.prompt,
				active:
					p.active === true ||
					on.has(p.prompt) ||
					!!prompts.get(p.prompt)?.active,
			});
		for (const prompt of on)
			if (prompt && !prompts.has(prompt))
				prompts.set(prompt, { prompt, active: true });
		file.systemPrompts.push(...prompts.values());
		const chats = await tables.all("conversations");
		for (const c of chats)
			if (c.summary && !c.isTemporary && !SESSION.test(c.id))
				file.summaries.push({ chat: c.name, text: c.summary });
		const titles = new Map(chats.map((c) => [c.id, c.name]));
		for (const m of await tables.all("pinnedMessages"))
			if (m.content)
				file.pinned.push({
					role: m.role,
					text: m.content,
					at: m.pinnedAtUnixTimestamp,
					chat: titles.get(m.conversationId),
				});
	}

	/** The pages a reply drew on, as the file keeps them. */
	const sourcesOf = (list) => {
		const sources = (list ?? [])
			.filter((s) => s?.url)
			.map(({ title, url }) => ({ title, url }));
		return sources.length ? { sources } : {};
	};

	/** What a character says of itself beyond its name and notes, as the file keeps it. */
	const aboutOf = (c) => ({
		...(c.context && { context: c.context }),
		...(c.tags?.length && { tags: c.tags }),
		...(c.useCustomSystemPrompt &&
			c.customSystemPrompt && { systemPrompt: c.customSystemPrompt }),
	});

	/** Whether a memory is a note, or one gathered from chats, and not a document's piece. */
	const noted = (m) =>
		typeof m.chunkIndex !== "number" &&
		(m.memoryType === "user" || m.memoryType === "extracted_summary");

	/** The memories for the character `id`, as its place in the file keeps them: its notes,
	 * and its Chat Insights. */
	const theirs = (id, { remembered, profiles }) => ({
		memories: remembered
			.filter((m) => m.characterId === id && noted(m))
			.map((m) => m.text),
		profiles: profiles.filter((e) => e.characterId === id).map(said),
	});

	/** Classic chats and what's around them: the characters, the folders the user made (the site keeps
	 * one of its own for each character's chats), and the videos Studio keeps as a chat of its own. */
	async function classic(file, tables, memory, seen, later) {
		const [chats, messages, cast, folders] = await Promise.all([
			tables.all("conversations"),
			tables.all("messages"),
			tables.all("characters"),
			tables.all("folders"),
		]);
		file.folders = folders
			.filter((f) => !f.characterId)
			.map((f) => ({ id: f.id, name: f.name }));
		for (const c of cast) {
			if (stopped) return;
			const at = where(c.photoMedia);
			// One added from the site's own list keeps its picture in its row instead.
			const inRow = !at && /^data:image\//.test(c.photo ?? "");
			put(file.cast, {
				id: c.id,
				name: c.name,
				description: c.description,
				intro: c.intro,
				instructions: c.instructions,
				...aboutOf(c),
				...((at || inRow) && {
					photo: await dataOf(
						at ? await found(...at) : await pictureOf(c.photo),
					),
				}),
				...theirs(c.id, memory),
			});
		}
		const lists = byChat(
			messages.filter((m) => !m.isPlaceholder),
			(m) => m.conversationId,
		);
		const kept = chats.filter((c) => !c.isTemporary);
		for (const [i, c] of kept.entries()) {
			if (stopped) return;
			say("Reading your chats…", `Chat ${i + 1} of ${kept.length}.`);
			const list = (lists.get(c.id) ?? []).sort(
				(a, b) => a.createdAtUnixTimestamp - b.createdAtUnixTimestamp,
			);
			await roomy(file);
			seen.add(c.id);
			if (SESSION.test(c.id)) {
				for (const m of list)
					if (m.fileName) {
						await roomy(file);
						const data = await dataOf(await foundAt(m.fileName));
						put(file.studio, {
							id: m.id,
							kind: (m.fileType ?? "").startsWith("video/") ? "video" : "image",
							prompt: m.content ?? "",
							model: m.modelName ?? m.modelId,
							at: m.createdAtUnixTimestamp,
							data,
						});
					}
				continue;
			}
			// What a later version wrote to its own copy of the chat since, after it: the messages only it has.
			const ids = new Set(list.map((m) => m.id));
			const since = later.lists.get(c.id)?.filter((m) => !ids.has(m.id)) ?? [];
			const rows = [
				...(await readEach(list, (m) => row(m, tables))),
				...(await readEach(since, (m) => laterRow(m, later.attachments))),
			];
			put(file.chats, {
				id: c.id,
				title: c.name,
				at: c.createdAtUnixTimestamp,
				...(c.characterId && { character: c.characterId }),
				...(c.folderId && { folder: c.folderId }),
				messages: rows,
			});
		}
	}

	/** A later version's store of Classic's chats, read once for both passes: their messages by chat,
	 * and the files attached to them. */
	async function laterStore() {
		const db = await opened(MINDS);
		if (!db) return { lists: new Map(), attachments: new Map() };
		const at = (m) => m.createdAtUnixTimestamp ?? 0;
		try {
			const said = await documents(db, /^messages-\d+-documents$/);
			const files = await documents(
				db,
				/^messageFileAttachments-\d+-documents$/,
			);
			// Each chat's messages in the order they were written, placeholders aside.
			const lists = byChat(
				said.filter((m) => !m.isPlaceholder).sort((a, b) => at(a) - at(b)),
				(m) => m.conversationId,
			);
			return { lists, attachments: new Map(files.map((a) => [a.id, a])) };
		} finally {
			db.close();
		}
	}

	/** What Studio made: pictures, and sound, each under the turn that asked for it. */
	async function studio(file, tables) {
		const sets = [
			["image", "studioImageTurns", "studioImageTurnMedia"],
			["audio", "studioAudioTurns", "studioAudioTurnMedia"],
		];
		for (const [kind, turnTable, mediaTable] of sets) {
			const turns = new Map(
				(await tables.all(turnTable)).map((t) => [t.id, t]),
			);
			const media = (await tables.all(mediaTable)).sort(oldest);
			for (const [i, m] of media.entries()) {
				if (stopped) return;
				say("Reading your Studio work…", `${i + 1} of ${media.length}.`);
				// A picture the user gave Studio to work from isn't one it made.
				if (!m.fileName || m.isUserUploaded) continue;
				if (m.mediaRole && m.mediaRole !== "output") continue;
				await roomy(file);
				const prompt = m.prompt ?? turns.get(m.turnId)?.prompt ?? "";
				const data = await dataOf(await foundAt(m.fileName));
				put(file.studio, {
					id: m.id,
					kind,
					prompt,
					// Sound is a file here, named for what was asked.
					...(kind === "audio" && {
						name: nameOf(
							`${prompt.slice(0, 40).replace(/[\s.]+$/, "") || "Sound"}.mp3`,
						),
					}),
					model: m.modelName ?? m.modelId,
					at: m.createdAtUnixTimestamp,
					data,
				});
			}
		}
	}

	/** What the user added to Studio's Movie Editor: files named for their hash, a `.meta` beside each
	 * saying what it's called. `library_…` are the Library's own, which come with the Library. */
	async function editorClips(file, tables) {
		const dir = await folder(["video-editor", "_shared"]);
		if (!dir) return;
		const handles = new Map();
		for await (const [name, handle] of dir.entries())
			if (handle.kind === "file") handles.set(name, handle);
		// What another account's project alone holds, named by its project's folder.
		const sessions = (await tables?.everyones("videoEditorSessions")) ?? [];
		const refs = async (list) => {
			const out = new Set();
			for (const s of list) {
				const at = await folder(["video-editor", String(s.id)]);
				if (!at) continue;
				for await (const [name] of at.entries())
					if (name.endsWith(".ref")) out.add(name.slice(0, -4));
			}
			return out;
		};
		const mine = await refs(sessions.filter(belongs));
		const others = await refs(sessions.filter((s) => !belongs(s)));
		const clips = [];
		for (const [name, handle] of handles) {
			if (!name.endsWith(".meta")) continue;
			const meta = await handle
				.getFile()
				.then((f) => f.text())
				.then(JSON.parse)
				.catch(() => null);
			if (typeof meta?.name === "string" && meta.name)
				if (!meta.name.startsWith("library_")) {
					const hash = name.slice(0, -5);
					if (mine.has(hash) || !others.has(hash))
						clips.push({ meta, bytes: handles.get(hash) });
				}
		}
		clips.sort((a, b) => (a.meta.storedAt ?? 0) - (b.meta.storedAt ?? 0));
		for (const { meta, bytes } of clips) {
			if (stopped) return;
			await roomy(file);
			const held = await bytes?.getFile().catch(() => null);
			// Named by its hash, it has no type of its own.
			const typed = held?.slice(0, held.size, meta.mimeType ?? "");
			const kept = await stored(nameOf(meta.name), typed ?? null);
			put(file.uploads, { kind: meta.type, ...kept });
		}
	}

	/** All of a collection's documents but those deleted, from the store of every version of its shape
	 * a browser used across versions still holds (`-4-documents`, `-5-`), each one's newest copy. */
	async function documents(db, test, everyones = false) {
		const version = (name) => Number(/-(\d+)-documents$/.exec(name)?.[1]);
		const names = [...db.objectStoreNames].filter((n) => test.test(n));
		const newest = new Map();
		for (const name of names.sort((a, b) => version(a) - version(b)))
			for (const row of await answer(
				db.transaction(name).objectStore(name).getAll(),
			))
				if (row?.d) newest.set(row.d.id ?? Symbol(), row.d);
		return [...newest.values()].filter(
			(d) => !d._deleted && (everyones || belongs(d)),
		);
	}

	/** The objects in `list`, or none when it isn't a list: what's of a shape this doesn't know is
	 * passed over, and doesn't end the run. */
	const objects = (list) =>
		Array.isArray(list) ? list.filter((x) => x && typeof x === "object") : [];
	/** An Agentic message's items. */
	const itemsOf = (m) => objects(m.output_items);
	/** An item's parts. One that holds its words as they are, and not in parts, is one part of
	 * words. */
	const partsOf = (item) =>
		typeof item.content === "string"
			? [{ type: "output_text", text: item.content }]
			: objects(item.content);

	/** A code block nothing in `code` can close. */
	function fenced(code, language) {
		const longest = Math.max(
			2,
			...[...code.matchAll(/`+/g)].map((run) => run[0].length),
		);
		const fence = "`".repeat(longest + 1);
		return `${fence}${language}\n${code}\n${fence}`;
	}

	/** What one of the agent's tools showed the user, as words where it was: a diagram as its code, and
	 * questions with what they offered, and the user's answers as the site shows them. */
	function shownBy(item) {
		if (item.type === "mermaidDiagram" && item.mermaid_code)
			return fenced(item.mermaid_code, "mermaid");
		if (item.type === "questionnaire")
			return objects(item.questions)
				.map((q) =>
					[
						q.question,
						...objects(q.options).map((o) => `- ${o.label ?? o.value ?? ""}`),
						...(Array.isArray(q.options)
							? q.options
									.filter((o) => typeof o === "string")
									.map((o) => `- ${o}`)
							: []),
					].join("\n"),
				)
				.join("\n\n");
		if (item.type === "questionnaireAnswer")
			return objects(item.questions)
				.flatMap((q) => {
					const answer = item.answers?.[q.id];
					if (answer === undefined || answer === null || answer === "")
						return [];
					const said = Array.isArray(answer) ? answer.join(", ") : answer;
					return [`${q.question}\n${said}`];
				})
				.join("\n\n");
		return "";
	}

	/** The pages a reply read and the pictures it found, which are on those pages: the file holds their
	 * addresses, as this asks no server for anything. */
	const pagesIn = (items) =>
		items.flatMap((item) => {
			if (item.type === "webSearch") return item.sources ?? [];
			if (item.type === "webScrape") return [{ url: item.url }];
			if (item.type === "imageSearch")
				return objects(item.requests).flatMap((request) =>
					objects(request.images).map((image) => ({
						title: image.title,
						url: image.source_url ?? image.url,
					})),
				);
			return [];
		});

	/** An Agentic message: its words, parts, thinking, and files. A text file's words are read as they
	 * are, another file goes as it is, or once gone as the words the site read of it (`parsed`). */
	async function mind(chat, m, parsed) {
		const items = itemsOf(m);
		const messageWords = (item) =>
			partsOf(item)
				.filter((part) => part.type === "output_text")
				.map((part) => part.text ?? "")
				.join("");
		const words = (type) =>
			items
				.filter((item) => item.type === type)
				.map(messageWords)
				.filter(Boolean);
		const files = [];
		for (const part of items.flatMap(partsOf)) {
			const at = part.media_id && (await found(chat.id, part.media_id));
			if (part.type === "input_file") {
				const name = part.filename ?? "File";
				const read = parsed.get(part.media_id);
				if (part.mime_type === "text/plain" && at)
					files.push({ name, text: await at.text() });
				else if (!at && read) files.push({ name, text: read });
				else files.push(await stored(name, at));
			} else if (part.type === "input_image")
				files.push(await stored("Picture.jpg", at));
			else if (part.type === "output_image")
				files.push(await stored("Picture", at));
		}
		// An app it made, for Morse to open as one of its artifacts.
		for (const item of items)
			if (item.type === "html_sandbox" && item.code) {
				const title =
					String(item.title ?? "")
						.replace(/_/g, " ")
						.trim() || "App";
				files.push({ name: `${title}.html`, page: title, html: item.code });
			}
		// A video is an item of its own, with no parts.
		for (const item of items)
			if (item.type === "videoGeneration" && item.media_id)
				files.push(await stored("Video", await found(chat.id, item.media_id)));
		const thought = m.role === "assistant" && words("reasoning").join("\n\n");
		return {
			role: m.role,
			content: items
				.flatMap((item) =>
					item.type === "message" ? messageWords(item) : [shownBy(item)],
				)
				.filter(Boolean)
				.join("\n\n"),
			at: m.created_at_unix_timestamp,
			...(thought && { reasoning: thought }),
			...(files.length && { files }),
			...sourcesOf(pagesIn(items)),
		};
	}

	/** A Classic message as a later version keeps it, beside the Agentic ones: what it made and what
	 * was attached are documents of their own, named on it by id, their files under its chat. */
	async function laterRow(m, attachments) {
		const out = {
			role: m.role,
			content: m.content ?? "",
			at: m.createdAtUnixTimestamp,
			...sourcesOf(m.references),
			...(m.role === "assistant" &&
				m.reasoningContent && { reasoning: m.reasoningContent }),
		};
		const files = [];
		const of = (id) => found(m.conversationId, id);
		for (const id of m.messageImageIds ?? [])
			files.push(await stored("Picture", await of(id)));
		for (const id of m.messageVideoIds ?? [])
			files.push(await stored("Video", await of(id)));
		for (const id of m.messageImageAttachmentIds ?? [])
			files.push(await stored("Picture.jpg", await of(id)));
		for (const id of m.messageVideoAttachmentIds ?? [])
			files.push(await stored("Video", await of(id)));
		for (const id of m.messageAudioAttachmentIds ?? [])
			files.push(await stored("Sound", await of(id)));
		// Music or speech it made has no document of its own: the message says what type it is.
		if (m.role === "assistant" && (m.musicContentType || m.audioContentType))
			files.push(await stored("Sound", await of(m.id)));
		for (const id of m.messageFileAttachmentIds ?? []) {
			const a = attachments.get(id);
			const name = a?.fileName ?? "File";
			files.push(
				a?.parsedText
					? { name, text: a.parsedText }
					: await stored(name, await of(id)),
			);
		}
		if (m.role === "assistant" && files.length && m.modelType !== "text")
			out.content = "";
		if (files.length) out.files = files;
		return out;
	}

	/** `a` and then `b`, which runs on from a little of `a`'s end, as a document's pieces do: what
	 * they share once. Pieces that share less than a few words are a space apart. */
	function stitched(a, b) {
		// The longest end of `a` that `b` opens with, by the prefix function of `b`, then `a`'s end.
		const s = `${b}\u0000${a.slice(-b.length)}`;
		const longest = new Array(s.length).fill(0);
		for (let i = 1; i < s.length; i++) {
			let k = longest[i - 1];
			while (k && s[i] !== s[k]) k = longest[k - 1];
			longest[i] = s[i] === s[k] ? k + 1 : k;
		}
		const shared = longest.at(-1);
		return shared >= 12 ? a + b.slice(shared) : `${a} ${b}`;
	}

	/** The documents the user gave the site's memory, from their pieces: each its file's name, which
	 * opens its first piece, and its words, as the site kept them. */
	function documentsOf(pieces) {
		const bySource = new Map();
		for (const m of pieces)
			bySource.set(m.source, [...(bySource.get(m.source) ?? []), m]);
		return [...bySource.values()]
			.sort((a, b) => oldest(a[0], b[0]))
			.map((list) => {
				const [first, ...rest] = list
					.sort((a, b) => a.chunkIndex - b.chunkIndex)
					.map((m) => m.text ?? "");
				const head = /^([^\n]+)\n\n/.exec(first);
				let text = head ? first.slice(head[0].length) : first;
				for (const next of rest) text = stitched(text, next);
				room -= text.length;
				return { name: nameOf(head?.[1] ?? "Memory document"), text };
			});
	}

	/** Agentic chats, the memories kept beside them, and any Classic chats a later version keeps
	 * there that the Classic tables didn't hold (`seen`). */
	async function minds(file, seen, memory, store) {
		const { remembered, profiles } = memory;
		const db = await opened(MINDS);
		if (!db) return;
		try {
			// The chats the site lists: not the one the user built a Mind in, nor one it said it wouldn't keep.
			const chats = (
				await documents(db, /^mindConversations-\d+-documents$/)
			).filter((c) => (!c.type || c.type === "chat") && !c.isTemporary);
			// The Minds the user made, which their chats go with. One of the community's is
			// the site's own, and only its id is here.
			file.minds = (await documents(db, /^minds-\d+-documents$/)).map((m) => ({
				id: m.id,
				name: m.name,
				instructions: m.systemPrompt?.instructions ?? "",
				...(m.description && { description: m.description }),
				...(m.openingInstruction && { opening: m.openingInstruction }),
			}));
			const messages = await documents(db, /^mindMessages-\d+-documents$/);
			// The user's notes, what the site gathered, and documents given it, in pieces (`chunkIndex`)
			// under one `source`. A character's own are that character's.
			const mine = remembered.filter(
				(m) => m.characterId === "chat_memory" || m.memoryType === "book",
			);
			file.memories = mine.filter(noted).map((m) => m.text);
			// What Studio's newer projects made, as a later version keeps it: a file it names, which this
			// finds by name, wherever it is. What the user gave it isn't what it made.
			const outputs = (
				await documents(db, /^studioOutputs-\d+-documents$/)
			).filter(
				(o) =>
					o.op !== "upload" &&
					!o.error &&
					typeof o.media?.filename === "string" &&
					o.media.filename,
			);
			for (const o of outputs) {
				if (stopped) return;
				await roomy(file);
				const path = o.media.filename;
				const data = await dataOf(
					(path.includes("/") && (await foundAt(path))) ||
						(await byName(path.split("/").at(-1))),
				);
				put(file.studio, {
					id: o.id,
					kind: o.kind,
					prompt: o.prompt ?? o.effectivePrompt ?? "",
					model: o.modelName ?? o.modelId,
					at: o.createdAtUnixTimestamp,
					data,
				});
			}
			// The user's own files in the site's Library, under `user-media/` by id.
			const uploads = (await documents(db, /^userMedia-\d+-documents$/)).sort(
				oldest,
			);
			for (const u of uploads) {
				if (stopped) return;
				await roomy(file);
				const kept = await stored(
					nameOf(u.filename || "File"),
					await foundIn(["user-media"], u.id),
				);
				put(file.uploads, { kind: u.kind, ...kept });
			}
			// Chat Insights across every chat, not one character's.
			file.profiles = profiles
				.filter((e) => !e.characterId || e.characterId === "venice-default")
				.map(said);
			file.documents = documentsOf(
				mine.filter((m) => typeof m.chunkIndex === "number"),
			);
			const lists = byChat(messages, (m) => m.mind_conversation_id);
			for (const [i, c] of chats.entries()) {
				if (stopped) return;
				say("Reading your chats…", `Agentic chat ${i + 1} of ${chats.length}.`);
				await roomy(file);
				const list = (lists.get(c.id) ?? []).sort(
					(a, b) => a.created_at_unix_timestamp - b.created_at_unix_timestamp,
				);
				const parsed = new Map(
					list
						.flatMap(itemsOf)
						.filter(
							(item) => item.type === "documentParsing" && item.extracted_text,
						)
						.map((item) => [item.source_media_id, item.extracted_text]),
				);
				const rows = await readEach(list, (m) => mind(c, m, parsed));
				put(file.chats, {
					id: c.id,
					title: c.name,
					at: c.createdAtUnixTimestamp,
					...(c.mindId && { mind: c.mindId }),
					messages: rows,
				});
			}
			// A Temporary chat stays behind here too, as it does from the Classic tables. One they hold
			// too came with them, with the messages only this copy has (`classic`).
			const { lists: laterLists, attachments } = store;
			const later = (
				await documents(db, /^conversations-\d+-documents$/)
			).filter((c) => !seen.has(c.id) && !c.isTemporary && !SESSION.test(c.id));
			// Its characters' and folders' words, the later, whether or not it holds a chat of its own.
			for (const c of await documents(db, /^characters-\d+-documents$/)) {
				const { name, description, intro, instructions } = c;
				const words = { name, description, intro, instructions, ...aboutOf(c) };
				// One the Classic tables hold too takes the words this copy has, which are the later.
				const had = file.cast.find((x) => x.id === c.id);
				// Its picture is the file's to hold, as any other is.
				const kept = typeof c.base64PhotoData === "string" && c.base64PhotoData;
				// Its memories go with it, as a Classic character's do.
				if (had)
					for (const k of Object.keys(words)) had[k] = words[k] ?? had[k];
				else
					put(file.cast, {
						id: c.id,
						...words,
						...(kept && { photo: await dataOf(await pictureOf(kept)) }),
						...theirs(c.id, memory),
					});
			}
			for (const f of await documents(db, /^folders-\d+-documents$/)) {
				const had = file.folders.find((x) => x.id === f.id);
				if (had) had.name = f.name;
				else if (!f.characterId) file.folders.push({ id: f.id, name: f.name });
			}
			for (const [i, c] of later.entries()) {
				if (stopped) return;
				say("Reading your chats…", `Chat ${i + 1} of ${later.length}.`);
				await roomy(file);
				const list = laterLists.get(c.id) ?? [];
				const rows = await readEach(list, (m) => laterRow(m, attachments));
				put(file.chats, {
					id: c.id,
					title: c.name,
					at: c.createdAtUnixTimestamp,
					...(c.characterId && { character: c.characterId }),
					...(c.folderId && { folder: c.folderId }),
					messages: rows,
				});
			}
		} finally {
			db.close();
		}
	}

	const count = (n, one) =>
		`${n.toLocaleString("en-US")} ${n === 1 ? one : `${one}s`}`;

	/** The file, a part at a time: no one string holds it all, which for a long history would be
	 * longer than a browser's longest string. */
	function saved(file) {
		const parts = ["{"];
		const fields = Object.entries(file);
		for (const [i, [key, value]] of fields.entries()) {
			parts.push(i ? "," : "", JSON.stringify(key), ":");
			if (Array.isArray(value)) {
				parts.push("[");
				value.forEach((item, j) => {
					parts.push(j ? "," : "", JSON.stringify(item));
				});
				parts.push("]");
			} else parts.push(JSON.stringify(value));
		}
		parts.push("}");
		return new Blob(parts, { type: "application/json" });
	}

	async function run() {
		const known = await window.indexedDB?.databases?.();
		say("Opening Venice…");
		const app = await theApp();
		await signedIn(app);
		await learnAgenticOwner();
		const tables = await classicTables(app);
		if (!tables && !known?.some((d) => d.name === MINDS)) {
			say("Couldn't find your Venice data in this browser.");
			troubled = true;
			return;
		}
		say("Reading your chats…");
		const file = {
			format: "morse.venice-export",
			version: 2,
			exportedAt: new Date().toISOString(),
			source: "venice.ai",
			folders: [],
			minds: [],
			cast: [],
			memories: [],
			profiles: [],
			documents: [],
			uploads: [],
			systemPrompts: [],
			pinned: [],
			summaries: [],
			studio: [],
			chats: [],
		};
		current = file;
		try {
			const memory = await remembering();
			if (tables) await kept(file, tables);
			// Every Classic chat read, across every file saved: a later version may keep them again.
			const seen = new Set();
			const later = await laterStore();
			if (tables) await classic(file, tables, memory, seen, later);
			await minds(file, seen, memory, later);
			if (tables) await studio(file, tables);
			await editorClips(file, tables);
		} finally {
			// Left open, it would keep the site from updating its own database.
			tables?.close();
			appFrame?.remove();
		}
		// The run's last file says whether it read all there was, for the import to say what's missing.
		file.partial = stopped;
		await save(file);
		if (!total.files) {
			if (locked)
				say(
					"Your Classic chats are still encrypted. Open Classic Chat on Venice and run this again.",
				);
			else if (signedOut())
				say(
					"You're signed out of Venice.",
					"Sign in and run this again to save your chats.",
				);
			else
				say(
					"This account has no chats saved in this browser.",
					"If you chat on another account or in another browser, sign in there and run this again.",
				);
			return;
		}
		told(
			stopped
				? "Saved what was done."
				: `Done. Your ${total.files > 1 ? "files are" : "file is"} in your downloads.`,
		);
	}

	/** Says `what` and what's been saved, in every file so far, and how to bring it into Morse. */
	function told(what, after = "") {
		const several = total.files > 1;
		openMorse.style.display = "";
		const missing = [
			left && ` ${count(left, "file")} couldn't be saved.`,
			odd && ` ${count(odd, "message")} couldn't be read.`,
			signedOut() &&
				" You're signed out of Venice, so only chats from while signed out came. Sign in and run this again for your account's.",
			locked &&
				` ${count(locked, "Classic chat")} ${locked === 1 ? "is" : "are"} still encrypted. Open Classic Chat on Venice and run this again to save ${locked === 1 ? "it" : "them"}.`,
		]
			.filter(Boolean)
			.join("");
		say(
			what,
			`${count(total.chats, "chat")} and ${count(total.messages, "message")}${several ? `, in ${total.files} files` : ""}.${missing} Now open Morse and choose ${several ? "them" : "it"} from your downloads.${after}`,
		);
	}

	run()
		.catch(async (error) => {
			troubled = true;
			// What was read before it went wrong is saved, as Stop saves it, and says it stopped partway.
			if (current) current.partial = true;
			if (current) await save(current).catch(() => {});
			if (total.files)
				told(
					"Something went wrong partway, and this saved what was done.",
					` What went wrong: ${error}`,
				);
			else say("Something went wrong reading Venice.", String(error));
		})
		.finally(() => {
			window.__morseVenice.running = false;
			stopButton.style.display = "none";
			closeButton.style.display = "";
			if (troubled || left || odd) reportButton.style.display = "";
			else if (total.files) quietReport.style.display = "";
		});
})();
