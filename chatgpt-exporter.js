// Morse's exporter for ChatGPT, kept apart from the others. The user runs it on chatgpt.com, from a
// bookmark or the browser's console. It saves JSON that Morse's import reads (`morse.chatgpt-export`,
// readers/chatgpt-exporter.ts), in one file or, for a large history, several that each stand alone.
// Nothing goes anywhere but those files: it asks chatgpt.com what the page itself asks, with the
// user's own session, whose token stays in the page, and changes nothing there.
//
// The custom instructions, what ChatGPT remembers, each project's name, instructions, and files, the
// pictures in the library, and every chat as the site gives it, with the files it holds, so no one
// waits days for ChatGPT's own export, which the import merges this with all the same. The site soon
// says to wait when chats are read one after another, so it reads them a beat apart, slower each
// time it's told to wait, and a run cut short goes on from there the next time.
//
// It's kept self-contained and plain, since it runs as a `javascript:` bookmark: no imports, no
// module syntax.
(() => {
	if (window.__morseChatgpt?.running) return;
	window.__morseChatgpt?.close();
	if (!/(^|\.)chatgpt\.com$/.test(location.hostname)) {
		alert("Open chatgpt.com in this tab, then run the Morse exporter again.");
		return;
	}

	/** Where Morse's import is, for the button that ends a run. */
	const MORSE = "https://trymorse.ai/chat?import=open";
	/** Where a report of a run that went wrong goes. */
	const HELP = "hello@trymorse.ai";
	/** The quiet report's look: words, not a button. */
	const QUIET =
		"border:0;background:none;padding:0;margin-top:8px;font:inherit;font-size:13px;color:#555;text-decoration:underline;cursor:pointer;text-align:left;";
	/** A file larger than this stays out: the file is read whole. */
	const MAX_FILE = 96 * 1024 * 1024;
	/** What a file may hold, in characters: past that, one too long to read back whole would lose all
	 * of it. */
	const ROOM = 320 * 1024 * 1024;
	/** With less than this left, what comes next goes in a new file: the largest this can hold. */
	const LOW = (MAX_FILE * 4) / 3 + 1024;
	/** The longest side of a picture in the file. */
	const PICTURE = 1600;
	/** How many of a list a page asks for, and how many pages a list may run to. */
	const PAGE = 50;
	const MAX_PAGES = 500;
	/** How many times it asks again when told to wait, and the longest it waits, in ms. */
	const TRIES = 7;
	const LONGEST = 60_000;
	/** The beat between one chat and the next, in ms, and the longest it grows to as the site says to
	 * wait. */
	const GAP = 600;
	const MOST_GAP = 8000;
	/** Past this, on average over the last 10 chats, with the site saying to wait among them, it has
	 * slowed the reading for good, so the run saves what it has rather than going on for hours. */
	const SLOWEST = 15_000;
	/** Where what a run cut short saved is kept, in the site's own storage, for the next to go on. */
	const KEPT = "morse-export:chatgpt.com";

	let room = ROOM;
	/** Files named and not saved, and chats that couldn't be read, for the panel to say. */
	let left = 0;
	let missed = 0;
	let stopped = false;
	/** What's been saved, for the panel to say. */
	const total = { files: 0, chats: 0, projects: 0, pictures: 0, memories: 0 };
	/** The beat before the next chat, and how many answers have come since the site last said to wait. */
	let gap = GAP;
	let streak = 0;
	/** How many times the site said to wait, for the report. */
	let waited = 0;
	/** Whether the site slowed the reading of chats so much that the run saved what it had. */
	let slowed = false;
	/** Whether a page of a list didn't come, so what's past it wasn't found. */
	let unlisted = false;
	/** Files the site didn't send though asked again, for a run that goes on to ask for again. */
	let unsent = 0;
	/** Whether the last ask ran out of tries, not answered that what it asked for is gone. */
	let gaveUp = false;
	/** The file being filled, once there is one. */
	let current = null;
	/** What the files read since the last thing put in the file come to. */
	let held = 0;

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
	title.textContent = "Saving your ChatGPT chats for Morse";
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
	// Where a run went wrong or left something out: what the panel says, to send us.
	const reportButton = button("Copy a report");
	reportButton.style.background = "#ececec";
	reportButton.style.color = "#111";
	reportButton.style.display = "none";
	// A run that went well offers it quietly, a line under what the panel says.
	const quietReport = button("Something missing? Copy a report");
	quietReport.style.cssText = QUIET;
	const closeButton = button("Close");
	// The question a run asks when an earlier one stopped partway.
	const overButton = button("Start over");
	const onButton = button("Go on");
	for (const b of [saveButton, closeButton, overButton, onButton, quietReport])
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
	// Settles once Stop is pressed, so a request the site is slow to answer doesn't hold it up.
	let halt;
	const halted = new Promise((done) => {
		halt = done;
	});
	stopButton.onclick = () => {
		stopped = true;
		halt(null);
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
			`ChatGPT said to wait: ${waited} times`,
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
	window.__morseChatgpt = { running: true, close };

	const pause = (ms) => new Promise((done) => setTimeout(done, ms));

	/** What chatgpt.com answers `path`, or null: it asks again when told to wait, or when the network
	 * drops, and a page that's gone or refused is as good as none. The sign-in token in `headers`
	 * goes to chatgpt.com alone, never to an address elsewhere it gives for a file. */
	async function asked(path, headers) {
		gaveUp = false;
		const own = new URL(path, location.origin).origin === location.origin;
		for (let tries = 0; tries < TRIES && !stopped; tries++) {
			const answer = await Promise.race([
				fetch(path, {
					credentials: "include",
					...(own && headers && { headers }),
				}).catch(() => null),
				halted,
			]);
			// Stopped, it waits no more.
			if (stopped) return null;
			if (answer?.ok) {
				// A while without being told to wait, it goes a little faster again.
				if (++streak > 20) [gap, streak] = [Math.max(GAP, gap * 0.75), 0];
				return answer;
			}
			if (answer && answer.status !== 429 && answer.status < 500) return null;
			if (answer?.status === 429)
				[gap, streak, waited] = [Math.min(gap * 2, MOST_GAP), 0, waited + 1];
			const told = Number(answer?.headers?.get?.("retry-after")) * 1000;
			await pause(Math.min(told || 1000 * 2 ** tries, LONGEST));
		}
		gaveUp = !stopped;
		return null;
	}

	async function jsonOf(path, headers) {
		const answer = await asked(path, headers);
		return answer ? answer.json().catch(() => null) : null;
	}

	/** `url` once there's room for it, or null, counted as left, when there's none. A chat's files
	 * past what this file has room for go in the next, the chats before saved. */
	async function fitted(url) {
		if (url && url.length > room && current) await save(current, true);
		if (!url || url.length > room) {
			left++;
			return null;
		}
		room -= url.length;
		held += url.length;
		return url;
	}

	/** A file as a `data:` URL, or null, counted as left, when it isn't there or there's no room. */
	async function dataOf(blob) {
		// Stopped, what it didn't ask for isn't lost: it's what wasn't read.
		if (stopped && !blob) return null;
		if (!blob || blob.size > MAX_FILE) {
			left++;
			return null;
		}
		return fitted(
			await new Promise((done) => {
				const reader = new FileReader();
				reader.onload = () => done(reader.result);
				reader.onerror = () => done(null);
				reader.readAsDataURL(blob);
			}),
		);
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

	/** `path`'s pages, each a list under `items`, the next asked for by the last's `cursor`, as `after`
	 * says, since the site's lists differ. A page with nothing new is the end. One that doesn't come,
	 * though asked again, cuts the list short (`cut`). */
	async function pagesOf(path, headers, after = "cursor", cut = () => {}) {
		const rows = new Map();
		let cursor = "";
		for (let page = 0; page < MAX_PAGES && !stopped; page++) {
			const got = await jsonOf(
				`${path}${path.includes("?") ? "&" : "?"}limit=${PAGE}${cursor && `&${after}=${encodeURIComponent(cursor)}`}`,
				headers,
			);
			// A page refused may be the list's end; one not sent though asked again cuts it short.
			if (!Array.isArray(got?.items)) {
				if (!stopped && gaveUp) {
					unlisted = true;
					cut();
				}
				break;
			}
			const before = rows.size;
			for (const item of got.items)
				rows.set(item.id ?? (item.gizmo?.gizmo ?? item.gizmo)?.id, item);
			if (!got.cursor || rows.size === before) break;
			cursor = got.cursor;
		}
		return [...rows.values()];
	}

	/** Each project as a later file needs it, to name it: the first holds its files. */
	const bare = ({ id, name, instructions }) => ({ id, name, instructions });

	const holds = (file) =>
		file.chats.length ||
		file.pictures.length ||
		file.memories.length ||
		file.instructions ||
		file.projects.some((p) => p.files);

	/** Saves `file` and leaves it empty for what's next. `partway` through what it's reading, one
	 * holding nothing yet isn't worth a file. */
	/** Saves `file`, the run's last unless `partway`. Only the last says whether the run read all
	 * there was (`partial`): one saved before it says nothing, so the last decides for the run, and
	 * one picked alone doesn't tell the user to run it all again. */
	async function save(file, partway = false) {
		if (!holds(file) && (total.files || partway)) return;
		const nth = total.files + 1;
		if (nth > 1)
			await pressed(
				partway || !stopped ? `Save file ${nth}` : "Save the last file",
			);
		const a = document.createElement("a");
		a.href = URL.createObjectURL(saved(file));
		const part = progress.part > 1 ? `-part-${progress.part}` : "";
		a.download = `chatgpt-morse-export${part}${nth > 1 ? `-${nth}` : ""}.json`;
		document.body.append(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
		total.files = nth;
		total.chats += file.chats.length;
		total.projects += file.projects.filter((p) => p.files).length;
		total.pictures += file.pictures.length;
		total.memories += file.memories.length;
		file.chats = [];
		file.pictures = [];
		file.memories = [];
		file.instructions = null;
		file.projects = file.projects.map(bare);
		room = ROOM - JSON.stringify(file.projects).length - held;
		progress.saved.push(...progress.held.splice(0));
		remember(false);
	}

	// What the files saved so far hold, kept in this browser once a run is cut short, so the next run
	// can go on from there: the ids of their chats, whether the pictures were read, and how many runs
	// there have been. Nothing else of the user's. It goes once a run saves all that was left, and when
	// the user starts over.
	const progress = { key: KEPT, earlier: null, part: 1, saved: [], held: [] };
	let picturesRead = false;
	/** Whether the settings, and every project with its files, came: else a run that goes on reads
	 * them again. */
	let settingsRead = true;
	let projectsRead = true;
	let picturesCut = false;
	/** What earlier runs saved, as kept under the run's key, or null. */
	function recalled() {
		try {
			const kept = JSON.parse(localStorage.getItem(progress.key) ?? "null");
			if (!Array.isArray(kept?.chats) || !kept.chats.length) return null;
			return {
				at: typeof kept.at === "string" ? kept.at : "",
				parts: Number.isInteger(kept.parts) && kept.parts > 0 ? kept.parts : 1,
				chats: kept.chats.filter((id) => typeof id === "string"),
				pictures: kept.pictures === true,
				settings: kept.settings !== false,
				projects: kept.projects !== false,
			};
		} catch {
			return null;
		}
	}
	/** Keeps what's saved for the next run, or forgets it once it's `whole`. A browser that won't keep
	 * it just starts over next time. */
	function remember(whole) {
		try {
			if (whole) return localStorage.removeItem(progress.key);
			localStorage.setItem(
				progress.key,
				JSON.stringify({
					at: new Date().toISOString(),
					parts: progress.part,
					chats: [...(progress.earlier?.chats ?? []), ...progress.saved],
					pictures: picturesRead || !!progress.earlier?.pictures,
					settings: settingsRead,
					projects: projectsRead,
				}),
			);
		} catch {}
	}
	/** Asks the user `what`, with Go on and Start over, and settles true for Go on. */
	function goOn(what, more) {
		stopButton.style.display = "none";
		say(what, more);
		overButton.style.display = onButton.style.display = "";
		onButton.focus();
		return new Promise((done) => {
			const answer = (on) => () => {
				overButton.style.display = onButton.style.display = "none";
				stopButton.style.display = "";
				done(on);
			};
			overButton.onclick = answer(false);
			onButton.onclick = answer(true);
		});
	}

	async function roomy(file) {
		if (room < LOW) await save(file, true);
	}

	/** Puts `item` in `list`, and with it what it held: its words take room too. */
	function put(list, item) {
		list.push(item);
		held = 0;
		room -= JSON.stringify(item, (key, value) =>
			key === "data" ? undefined : value,
		).length;
	}

	/** Where the site serves a file, as it answers `path`, or null. One it didn't say though asked
	 * again is a file not sent this time (`unsent`); one it no longer serves is gone there too. */
	async function linkOf(path, headers) {
		const asks = await jsonOf(path, headers);
		if (!asks?.download_url && gaveUp) unsent++;
		return asks?.download_url ? asks : null;
	}

	/** A file by the address that serves it, as a `data:` URL, a picture made smaller, or null. One
	 * the site didn't send though asked again is a file not sent this time (`unsent`). */
	async function fetched(url, headers, picture = false) {
		const answer = url ? await asked(url, headers) : null;
		if (url && !answer && gaveUp) {
			unsent++;
			return null;
		}
		const blob = answer ? await answer.blob().catch(() => null) : null;
		return dataOf(picture ? await smaller(blob) : blob);
	}

	/** The user's projects as the sidebar lists them. A GPT of the sidebar's isn't one. */
	const projectList = async (headers) =>
		(
			await pagesOf(
				"/backend-api/gizmos/snorlax/sidebar?conversations_per_gizmo=0",
				headers,
				"cursor",
				() => {
					projectsRead = false;
				},
			)
		).filter((item) => projectOf(item)?.id?.startsWith("g-p-"));
	const projectOf = (item) => item.gizmo?.gizmo ?? item.gizmo;

	/** The user's projects, with what each asks and the bytes of its files. */
	async function projectsOf(file, headers, list) {
		const sent = unsent;
		await projectsIn(file, headers, list);
		if (unsent !== sent || stopped) projectsRead = false;
	}

	async function projectsIn(file, headers, list) {
		for (const [i, item] of list.entries()) {
			if (stopped) return;
			say("Reading your projects…", `${i + 1} of ${list.length}.`);
			await roomy(file);
			const project = projectOf(item);
			const files = [];
			for (const f of item.gizmo?.files ?? item.files ?? []) {
				const id = f.file_id ?? f.id;
				const asks = await linkOf(
					`/backend-api/files/download/${id}?gizmo_id=${project.id}&inline=false`,
					headers,
				);
				// One gone is one this couldn't save; one not sent is counted as that already.
				if (!asks && !gaveUp) left++;
				files.push({
					name: f.name ?? "File",
					type: f.type,
					data: asks ? await fetched(asks.download_url) : null,
				});
			}
			put(file.projects, {
				id: project.id,
				name: project.display?.name,
				instructions: project.instructions ?? "",
				files,
			});
		}
	}

	/** The ids of the user's chats: the history's, its archive's, and each project's, which the history
	 * leaves out. */
	async function chatList(headers, projects) {
		// Each with when it was last written in, so the newest are read first: a run the site slows
		// down has saved those.
		const ids = new Map();
		const when = (item) => {
			const at = item.update_time ?? item.create_time;
			return typeof at === "number" ? at * 1000 : Date.parse(at ?? "") || 0;
		};
		for (const archived of ["", "&is_archived=true"])
			for (let offset = 0, page = 0; page < MAX_PAGES && !stopped; page++) {
				const got = await jsonOf(
					`/backend-api/conversations?offset=${offset}&limit=${PAGE}&order=updated${archived}`,
					headers,
				);
				if (!Array.isArray(got?.items)) {
					if (!stopped) unlisted = true;
					break;
				}
				const { items } = got;
				for (const item of items) if (item.id) ids.set(item.id, when(item));
				offset += items.length;
				if (!items.length || offset >= (got.total ?? Number.POSITIVE_INFINITY))
					break;
			}
		for (const item of projects) {
			const path = `/backend-api/gizmos/${projectOf(item).id}/conversations`;
			for (const chat of await pagesOf(path, headers))
				if (chat.id) ids.set(chat.id, when(chat));
		}
		return [...ids].sort((a, b) => b[1] - a[1]).map(([id]) => id);
	}

	/** The files a chat's turns name, by id: what the user attached, and what a part shows or plays. */
	function filesNamed(chat) {
		const named = new Map();
		for (const node of Object.values(chat.mapping ?? {})) {
			const message = node?.message;
			// What the user attached: a tool's own (a page it drew to look at) was never shown them.
			if (message?.author?.role === "user")
				for (const file of message.metadata?.attachments ?? [])
					if (file?.id) named.set(file.id, file.name);
			// A chart the code drew, which its output shows.
			for (const shown of message?.metadata?.aggregate_result?.messages ?? []) {
				const id = shown?.image_url?.split("://").at(-1);
				if (id && !named.has(id)) named.set(id, undefined);
			}
			for (const part of message?.content?.parts ?? []) {
				if (!part || typeof part !== "object") continue;
				const { audio_asset_pointer, video_container_asset_pointer } = part;
				for (const held of [
					part,
					audio_asset_pointer,
					video_container_asset_pointer,
					...(part.frames_asset_pointers ?? []),
				]) {
					const id = held?.asset_pointer?.split("://").at(-1);
					if (id && !named.has(id)) named.set(id, undefined);
				}
			}
		}
		return named;
	}

	/** `ms` as a person says it: "a minute", "20 minutes", "2 hours". */
	function roughly(ms) {
		const minutes = Math.max(1, Math.round(ms / 60_000));
		if (minutes === 1) return "a minute";
		if (minutes < 90) return `${minutes} minutes`;
		const hours = Math.round(minutes / 60);
		return `${hours} hours`;
	}

	/** The files ChatGPT made in a chat's sandbox that its replies link (`sandbox:/mnt/data/…`), each
	 * by the reply that links it and its path, as the site serves them. A name may hold spaces and its
	 * own brackets, as in `Q3 report (1).pdf`, or come with its spaces written `%20`. */
	function madeIn(chat) {
		const made = new Map();
		for (const [key, node] of Object.entries(chat.mapping ?? {})) {
			const message = node?.message;
			if (message?.author?.role !== "assistant") continue;
			for (const part of message.content?.parts ?? [])
				if (typeof part === "string")
					for (const [, link] of part.matchAll(
						/\]\(sandbox:((?:[^()\n]|\([^()\n]*\))*)\)/g,
					)) {
						const path = unescaped(link.trim());
						made.set(`${message.id ?? key} ${path}`, {
							message: message.id ?? key,
							path,
						});
					}
		}
		return [...made.values()];
	}

	/** A link's path with what it escapes (`%20`) read back, or as it's written if it doesn't read. */
	function unescaped(path) {
		try {
			return decodeURIComponent(path);
		} catch {
			return path;
		}
	}

	/** Each chat of `ids`, as the site gives it, with the bytes of the files it names, a beat apart. */
	async function chatsOf(file, headers, ids) {
		const began = Date.now();
		// When each chat was saved, and how many times the site had said to wait by then.
		const read = [];
		for (const [i, id] of ids.entries()) {
			if (stopped) return;
			const ten = read.at(-11);
			if (ten && (Date.now() - ten.at) / 10 > SLOWEST && waited > ten.waited) {
				slowed = true;
				return;
			}
			// After a few, how long the rest will take at the pace ChatGPT has allowed so far.
			const each = i >= 5 ? (Date.now() - began) / i : 0;
			const eta = each
				? ` About ${roughly(each * (ids.length - i))} left.`
				: "";
			say(
				"Reading your chats…",
				`Chat ${(i + 1).toLocaleString("en-US")} of ${ids.length.toLocaleString("en-US")}.${eta} ChatGPT only lets a page read chats so fast, so a long history takes a while. Stop saves what's done, and running this again goes on from there.`,
			);
			await roomy(file);
			await pause(gap);
			const chat = await jsonOf(`/backend-api/conversation/${id}`, headers);
			if (!chat?.mapping) {
				if (!stopped) missed++;
				continue;
			}
			const files = [];
			// A chat with a file the site didn't send this time is read again by a run that goes on.
			const sent = unsent;
			for (const [fileId, name] of filesNamed(chat)) {
				if (stopped) return;
				const asks = await linkOf(
					`/backend-api/files/download/${fileId}?conversation_id=${id}&inline=false`,
					headers,
				);
				// One ChatGPT no longer serves is gone there too, and isn't one this couldn't save.
				if (!asks) continue;
				const data = await fetched(asks.download_url, undefined, true);
				if (data) files.push({ id: fileId, ...(name && { name }), data });
			}
			// What its replies made, by the reply and the path, as ChatGPT's own export keeps them.
			for (const { message, path } of madeIn(chat)) {
				if (stopped) return;
				const asks = await linkOf(
					`/backend-api/conversation/${id}/interpreter/download?message_id=${encodeURIComponent(message)}&sandbox_path=${encodeURIComponent(path)}`,
					headers,
				);
				// One the sandbox no longer holds is gone there too.
				if (!asks) continue;
				const data = await fetched(asks.download_url);
				const name = asks.file_name ?? path.split("/").pop();
				if (data)
					files.push({
						id: `sandbox:${message}:${path}`,
						name,
						made: message,
						data,
					});
			}
			if (stopped) return;
			put(file.chats, { chat, files });
			if (unsent === sent) progress.held.push(id);
			read.push({ at: Date.now(), waited });
		}
	}

	/** A picture made smaller for the file, or itself if it can't be: a library runs to thousands. */
	async function smaller(file) {
		if (!file?.type.startsWith("image/") || !window.createImageBitmap)
			return file;
		try {
			const bitmap = await window.createImageBitmap(file);
			const scale = Math.min(
				1,
				PICTURE / Math.max(bitmap.width, bitmap.height),
			);
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
					canvas.toBlob(done, "image/jpeg", 0.85),
				)) ?? file
			);
		} catch {
			return file;
		}
	}

	/** The pictures in the library. */
	async function picturesOf(file, headers) {
		const items = await pagesOf(
			"/backend-api/my/recent/image_gen",
			headers,
			"after",
			() => {
				picturesCut = true;
			},
		);
		for (const [i, item] of items.entries()) {
			if (stopped) return;
			say("Reading your pictures…", `${i + 1} of ${items.length}.`);
			await roomy(file);
			const data = await fetched(item.url, headers, true);
			if (data)
				put(file.pictures, {
					id: item.id,
					title: item.title,
					prompt: item.prompt,
					at: item.created_at ?? item.create_time,
					data,
				});
		}
	}

	async function run() {
		const session = await jsonOf("/api/auth/session");
		const token = session?.accessToken;
		if (!token) {
			say("Sign in to ChatGPT in this tab, then run the exporter again.");
			return;
		}
		const headers = { authorization: `Bearer ${token}` };
		progress.key = `${KEPT}:${session.user?.id ?? "me"}`;
		const earlier = recalled();
		const when = earlier?.at
			? ` on ${new Date(earlier.at).toLocaleDateString("en-US", { month: "long", day: "numeric" })}`
			: "";
		const going =
			earlier &&
			(await goOn(
				`Your export${when} stopped partway, with ${count(earlier.chats.length, "chat")} saved.`,
				"Go on, and this run saves the rest as a file of its own, to import with the earlier one. Or start over and save everything again.",
			));
		if (going) [progress.earlier, progress.part] = [earlier, earlier.parts + 1];
		else if (earlier) remember(true);
		say("Reading your settings…");
		const file = {
			format: "morse.chatgpt-export",
			version: 1,
			exportedAt: new Date().toISOString(),
			source: "chatgpt.com",
			...(going && { part: progress.part }),
			instructions: null,
			memories: [],
			projects: [],
			pictures: [],
			chats: [],
		};
		current = file;
		// Going on, what the earlier run saved first is in its file already, unless some didn't come.
		if (!going || !earlier.settings) {
			file.instructions = await jsonOf(
				"/backend-api/user_system_messages",
				headers,
			);
			settingsRead = !gaveUp;
			const memories = await jsonOf("/backend-api/memories", headers);
			settingsRead &&= !gaveUp;
			file.memories = (memories?.memories ?? [])
				.map((m) => m.content)
				.filter(Boolean);
			if (!settingsRead) unlisted = true;
		}
		const projects = await projectList(headers);
		if (!going || !earlier.projects) await projectsOf(file, headers, projects);
		if (!stopped) {
			say("Finding your chats…");
			const done = new Set(earlier && going ? earlier.chats : []);
			const ids = (await chatList(headers, projects)).filter(
				(id) => !done.has(id),
			);
			await chatsOf(file, headers, ids);
		}
		// Slowed, the pictures wait for the run that goes on.
		if (!stopped && !slowed && !(going && earlier.pictures)) {
			const sent = unsent;
			await picturesOf(file, headers);
			picturesRead = !stopped && !picturesCut && unsent === sent;
		}
		file.partial = !!(stopped || missed || slowed || unlisted || unsent);
		await save(file);
		// All that was left is saved: the next run starts over.
		if (!file.partial) remember(true);
		if (slowed)
			return told(
				"ChatGPT slowed down how fast this can read your chats, so it saved your newest ones.",
				" For the rest, run this again in a few hours, and it goes on from there. Or ask for ChatGPT's own export, in Settings, then Data controls, then Export data, and import it with this file.",
			);
		told(
			stopped
				? `Saved what was done.${progress.saved.length ? " Run this again to go on from there." : ""}`
				: unlisted
					? "ChatGPT didn't send everything this asked for, so this saved what it did. Run this again to go on from there."
					: `Done. Your ${total.files > 1 ? "files are" : "file is"} in your downloads.`,
		);
	}

	const count = (n, one, many = `${one}s`) =>
		`${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

	/** Says `what` and what's been saved, and how to bring it into Morse. */
	function told(what, after = "") {
		const several = total.files > 1;
		openMorse.style.display = "";
		const lost = left ? ` ${count(left, "file")} couldn't be saved.` : "";
		const unread = missed ? ` ${count(missed, "chat")} couldn't be read.` : "";
		const again = unsent
			? ` ChatGPT didn't send ${count(unsent, "file")} this time, and running this again asks for ${unsent === 1 ? "it" : "them"} again.`
			: "";
		say(
			what,
			`${count(total.chats, "chat")}, ${count(total.projects, "project")}, ${count(total.memories, "memory", "memories")}, and ${count(total.pictures, "picture")}${several ? `, in ${total.files} files` : ""}.${lost}${unread}${again} Now open Morse and choose ${several ? "them" : "it"} from your downloads.${after}`,
		);
	}

	run()
		.catch(async (error) => {
			troubled = true;
			// What was read before it went wrong is saved, as Stop saves it.
			if (current) current.partial = true;
			if (current) await save(current).catch(() => {});
			if (total.files)
				told(
					"Something went wrong partway, and this saved what was done.",
					` What went wrong: ${error}`,
				);
			else say("Something went wrong reading ChatGPT.", String(error));
		})
		.finally(() => {
			window.__morseChatgpt.running = false;
			stopButton.style.display = "none";
			closeButton.style.display = "";
			if (troubled || left || missed || unlisted || unsent)
				reportButton.style.display = "";
			else if (total.files) quietReport.style.display = "";
		});
})();
