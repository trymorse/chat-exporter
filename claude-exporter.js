// Morse's exporter for Claude, kept apart from the others: Claude's own export holds most of what a
// user has there, and this holds what it leaves out. The user runs it on claude.ai, from a bookmark
// or the browser's console. It saves JSON that Morse's import reads (`morse.claude-export`,
// readers/claude-exporter.ts), in one file or, for a long history, several that each stand alone.
// Nothing goes anywhere but those files: it asks claude.ai what the page itself asks, with the user's
// own session, and changes nothing there.
//
// Every chat, with its pins, archive, project, and summary, and the bytes of what was uploaded to it
// or delivered in it, which Claude's export only names. Its custom instructions and styles, what it
// remembers, each project with its PDFs and the names of its synced documents, each project that works
// in threads with their files, each scheduled task with the words of its runs, and Code's
// sessions in the cloud. Claude Design and published artifacts are for Claude's own export, and the
// import merges the two.
//
// It's kept self-contained and plain, since it runs as a `javascript:` bookmark: no imports, no
// module syntax.
(() => {
	if (window.__morseClaude?.running) return;
	window.__morseClaude?.close();
	if (!/(^|\.)claude\.ai$/.test(location.hostname)) {
		alert("Open claude.ai in this tab, then run the Morse exporter again.");
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
	/** What a file may hold, in characters: past that, one too long to read back whole would lose every
	 * chat in it. */
	const ROOM = 320 * 1024 * 1024;
	/** With less than this left, what comes next goes in a new file: the largest upload this can hold. */
	const LOW = (MAX_FILE * 4) / 3 + 1024;
	/** A result's words past this are a tool's output, which no reply shows. */
	const MAX_RESULT = 16 * 1024;
	/** How many of Code's session events a page asks for, and how many pages a session may run to. */
	const EVENTS = 100;
	const MAX_PAGES = 500;
	/** How many chats or projects a page of a list asks for. */
	const PAGE = 100;
	/** How many times it asks again when told to wait, and the longest it waits, in ms. */
	const TRIES = 7;
	const LONGEST = 60_000;

	let room = ROOM;
	/** Files named and not saved, chats it couldn't read, for the panel to say. */
	let left = 0;
	let missed = 0;
	let stopped = false;
	/** Whether a page of a list didn't come, so what's past it wasn't found. */
	let unlisted = false;
	/** What the site said to the last ask that came back with nothing: its status where it refused,
	 * as for a list it doesn't have, or 0 where it was asked until there were no more tries. */
	let refusal = 0;
	/** What's been saved, for the panel to say. */
	const total = { files: 0, chats: 0, messages: 0 };
	/** The file being filled, once there is one. */
	let current = null;
	/** What the files read since the last thing put in the file come to: the chat being read holds
	 * them, and they go in whichever file that chat does. */
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
	title.textContent = "Saving your Claude data for Morse";
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
	window.__morseClaude = { running: true, close };

	const pause = (ms) => new Promise((done) => setTimeout(done, ms));

	/** What claude.ai answers `path`, or null: it asks again when told to wait, or when the network
	 * drops, and a page that's gone or refused is as good as none. */
	async function asked(path, headers) {
		refusal = 0;
		for (let tries = 0; tries < TRIES && !stopped; tries++) {
			const answer = await fetch(path, {
				credentials: "include",
				headers,
			}).catch(() => null);
			if (answer?.ok) return answer;
			if (answer && answer.status !== 429 && answer.status < 500) {
				refusal = answer.status;
				return null;
			}
			const told = Number(answer?.headers?.get?.("retry-after")) * 1000;
			await pause(Math.min(told || 1000 * 2 ** tries, LONGEST));
		}
		return null;
	}

	async function jsonOf(path, headers) {
		const answer = await asked(path, headers);
		return answer ? answer.json().catch(() => null) : null;
	}

	/** What Code's API asks of a page beyond its session. */
	const code = (org) => ({
		"anthropic-version": "2023-06-01",
		"x-organization-uuid": org,
	});

	const TYPES = {
		pdf: "application/pdf",
		docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
		csv: "text/csv",
		txt: "text/plain",
		md: "text/markdown",
		html: "text/html",
		json: "application/json",
		mp3: "audio/mpeg",
		wav: "audio/wav",
		m4a: "audio/mp4",
		mp4: "video/mp4",
		mov: "video/quicktime",
		zip: "application/zip",
	};

	/** `blob`, of the type its name says, as an upload's own address doesn't. */
	function typed(blob, name) {
		const extension = /\.([a-z0-9]+)$/i.exec(name ?? "")?.[1]?.toLowerCase();
		const told = blob.type === "application/octet-stream" ? "" : blob.type;
		const type = told || TYPES[extension];
		return type ? blob.slice(0, blob.size, type) : blob;
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

	/** The bytes of a file by its id, as the user uploaded it or Claude delivered it, as a `data:` URL.
	 * One written where a chat's code ran may be there alone, by its path. A picture uploaded before
	 * 2025 has no contents to give, only the preview Claude shows, read from where `file` says it is. */
	async function fileData(org, id, name, chat, path, file) {
		const at = `/api/organizations/${org}`;
		const ways = [
			id && `${at}/files/${id}/contents`,
			path &&
				chat &&
				`${at}/conversations/${chat}/wiggle/download-file?path=${encodeURIComponent(path)}`,
			file?.preview_asset?.url,
			file?.preview_url,
			file?.document_asset?.url,
			id && file?.file_kind === "image" && `/api/${org}/files/${id}/preview`,
		];
		let answer = null;
		// Only this site's own files, by their path.
		for (const way of new Set(ways))
			if (!answer && typeof way === "string" && way.startsWith("/api/"))
				answer = await asked(way);
		const blob = answer ? await answer.blob().catch(() => null) : null;
		return dataOf(blob && typed(blob, name));
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

	/** Each project as a later file needs it, to place its chats: the first holds its documents. */
	const bare = ({ uuid, name, prompt_template }) => ({
		uuid,
		name,
		prompt_template,
	});

	/** Whether `file` holds anything but what every file repeats. */
	const holds = (file) =>
		file.chats.length ||
		file.sessions.length ||
		file.rooms.length ||
		file.tasks.length ||
		file.styles.length ||
		file.memory.length ||
		file.instructions ||
		file.projects.some((p) => p.docs || p.files);

	/** Saves `file` and leaves it empty for what's next. `partway` through a chat, one holding nothing
	 * yet isn't worth a file, as the chat goes on; but the last, saying the run was cut short, is. */
	async function save(file, partway = false) {
		if (!holds(file) && !file.partial && (total.files || partway)) return;
		const nth = total.files + 1;
		if (nth > 1)
			await pressed(
				partway || !stopped ? `Save file ${nth}` : `Save the last file`,
			);
		const a = document.createElement("a");
		a.href = URL.createObjectURL(saved(file));
		a.download = nth > 1 ? `claude-export-${nth}.json` : "claude-export.json";
		document.body.append(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
		total.files = nth;
		total.chats += file.chats.length + file.sessions.length + file.rooms.length;
		total.messages +=
			file.chats.reduce((n, c) => n + c.chat_messages.length, 0) +
			file.sessions.reduce((n, s) => n + s.turns.length, 0) +
			file.rooms.reduce((n, r) => n + r.messages.length, 0);
		file.chats = [];
		file.sessions = [];
		file.rooms = [];
		file.tasks = [];
		file.styles = [];
		file.memory = [];
		file.instructions = "";
		file.projects = file.projects.map(bare);
		// What the chat still being read holds goes in the next file.
		room = ROOM - JSON.stringify(file.projects).length - held;
	}

	/** Goes on in a new file, when this one has too little room left for the next. */
	async function roomy(file) {
		if (room < LOW) await save(file);
	}

	/** Puts `item` in the file's `list`, and with it what it held: its words take room too, which a
	 * long history's do, and its files were counted as they were read. */
	function put(list, item) {
		list.push(item);
		held = 0;
		room -= JSON.stringify(item, (key, value) =>
			key === "data" ? undefined : value,
		).length;
	}

	/** Notes that a page of a list didn't come, past the first or as the site gave up being asked: a
	 * first page it refused is a list it doesn't have, which an older one stands in for. */
	function cut(after) {
		if (!stopped && (after || !refusal)) unlisted = true;
	}

	/** Every row of a list that's paged by `offset`, whichever shape it comes in. */
	async function allOf(path) {
		const rows = [];
		for (let offset = 0; !stopped; offset += PAGE) {
			const page = await jsonOf(
				`${path}${path.includes("?") ? "&" : "?"}limit=${PAGE}&offset=${offset}`,
			);
			const list = Array.isArray(page) ? page : page?.data;
			if (!Array.isArray(list)) {
				cut(offset > 0);
				break;
			}
			const before = rows.length;
			for (const row of list)
				if (!rows.some((r) => r.uuid === row.uuid)) rows.push(row);
			if (
				rows.length === before ||
				(page.has_more === undefined ? list.length < PAGE : !page.has_more)
			)
				break;
		}
		return rows;
	}

	/** A chat's rows: those in the sidebar and those archived, or from the older list if it's gone. */
	async function chatsOf(org) {
		const at = `/api/organizations/${org}/chat_conversations`;
		const [live, archived] = [
			await allOf(`${at}_v2?archived=false&consistency=strong`),
			await allOf(`${at}_v2?archived=true&consistency=strong`),
		];
		if (!live.length && !archived.length) return allOf(`${at}?`);
		const ids = new Set(live.map((row) => row.uuid));
		return [...live, ...archived.filter((row) => !ids.has(row.uuid))];
	}

	/** A block of a message as the file keeps it: what the app showed and the import reads, without
	 * what a long chat's tools repeat. */
	function trimmed(block) {
		const {
			start_timestamp,
			stop_timestamp,
			flags,
			signature,
			cut_off,
			alternative_display_type,
			integration_name,
			integration_icon_url,
			display_content,
			icon_name,
			structured_content,
			meta,
			...kept
		} = block;
		if (kept.type === "tool_result" && Array.isArray(kept.content))
			kept.content = kept.content.map((item) => {
				if (typeof item?.text !== "string") return item;
				// A search's pages are named by their titles: their words aren't shown.
				if (item.type === "knowledge") {
					const { text, metadata, ...rest } = item;
					return rest;
				}
				return item.text.length > MAX_RESULT
					? { ...item, text: item.text.slice(0, MAX_RESULT) }
					: item;
			});
		return kept;
	}

	const baseName = (path) => String(path).split("/").at(-1);

	/** A message as the file keeps it, with the bytes of each file it names. */
	async function messageOf(org, chat, m) {
		const content = Array.isArray(m.content) ? m.content.map(trimmed) : [];
		const out = {
			uuid: m.uuid,
			sender: m.sender,
			created_at: m.created_at,
			parent_message_uuid: m.parent_message_uuid,
			content,
			...(!content.length && { text: m.text }),
			...(m.attachments?.length && { attachments: m.attachments }),
		};
		const named = [...(m.files ?? []), ...(m.files_v2 ?? [])];
		// Files whose words Claude kept, as an attachment, in place of their bytes.
		const worded = new Set(
			(m.attachments ?? [])
				.filter((a) => a.extracted_content)
				.map((a) => a.file_name),
		);
		const seen = new Set();
		out.files = [];
		for (const file of named) {
			const id = file.file_uuid ?? file.uuid;
			if (!id || seen.has(id)) continue;
			seen.add(id);
			const name = file.file_name ?? "File";
			const before = left;
			const data = await fileData(org, id, name, null, null, file);
			// Without its bytes, its words still come over, so it isn't one that couldn't be saved.
			if (!data && worded.has(file.file_name)) left = before;
			out.files.push({ file_name: name, file_kind: file.file_kind, data });
		}
		for (const block of content) {
			if (block.type !== "tool_result") continue;
			for (const given of block.file_deliveries ?? []) {
				const name = baseName(given.path);
				given.name = name;
				given.data = await fileData(
					org,
					given.file_uuid,
					name,
					chat,
					given.path,
				);
			}
			for (const item of block.content ?? [])
				if (item?.type === "local_resource") {
					// Its name is often the file's without the extension its path has.
					if (item.file_path && !/\.\w+$/.test(item.name ?? ""))
						item.name = baseName(item.file_path);
					item.data = await fileData(
						org,
						item.uuid,
						item.name,
						chat,
						item.file_path,
					);
				}
		}
		return out;
	}

	/** A chat as the file keeps it, or null where it couldn't be read. */
	async function chatOf(org, row) {
		const chat = await jsonOf(
			`/api/organizations/${org}/chat_conversations/${row.uuid}?tree=True&rendering_mode=messages&render_all_tools=true`,
		);
		if (!Array.isArray(chat?.chat_messages)) {
			// One left waiting to be asked again when Stop was pressed isn't one that couldn't be read.
			if (!stopped) missed++;
			return null;
		}
		const messages = [];
		for (const m of chat.chat_messages) {
			// One cut short would pass for the whole chat when it's imported.
			if (stopped) return null;
			messages.push(await messageOf(org, row.uuid, m));
		}
		return {
			uuid: chat.uuid,
			name: chat.name ?? row.name,
			summary: chat.summary ?? row.summary,
			created_at: chat.created_at,
			updated_at: chat.updated_at,
			is_starred: chat.is_starred ?? row.is_starred,
			is_archived: chat.is_archived ?? row.is_archived,
			project_uuid: row.project_uuid ?? chat.project_uuid,
			current_leaf_message_uuid: chat.current_leaf_message_uuid,
			chat_messages: messages,
		};
	}

	/** Each of an org's projects the user made or chatted in, with its instructions, its documents,
	 * the bytes of its files, the names of what's synced to it, and what Claude remembers of it. The
	 * one Claude starts every account with isn't the user's. */
	async function projectsOf(file, org, me, rows) {
		const at = `/api/organizations/${org}`;
		const used = new Set(rows.map((r) => r.project_uuid));
		const list = (await allOf(`${at}/projects?include_harmony_projects=true`))
			.filter((p) => !p.is_starter_project)
			.filter((p) => p.creator?.uuid === me || used.has(p.uuid));
		const general = (await jsonOf(`${at}/memory`))?.memory ?? "";
		for (const [i, p] of list.entries()) {
			if (stopped) return;
			say("Reading your projects…", `${i + 1} of ${list.length}.`);
			await roomy(file);
			const here = `${at}/projects/${p.uuid}`;
			const whole = await jsonOf(here);
			const docs = (await jsonOf(`${here}/docs`)) ?? [];
			const files = [];
			for (const f of (await jsonOf(`${here}/files`)) ?? []) {
				const name = f.file_name ?? "File";
				files.push({
					name,
					kind: f.file_kind,
					data: await fileData(org, f.file_uuid ?? f.uuid, name, null, null, f),
				});
			}
			const synced = ((await jsonOf(`${here}/syncs`)) ?? []).map((s) => ({
				type: s.type,
				name: s.config?.resource?.title ?? s.config?.resource?.name,
				uri: s.config?.resource?.uri ?? s.config?.uri,
			}));
			const memory =
				(await jsonOf(`${at}/memory?project_uuid=${p.uuid}`))?.memory ?? "";
			put(file.projects, {
				uuid: p.uuid,
				name: p.name,
				prompt_template: whole?.prompt_template ?? "",
				docs: docs.map((d) => ({
					file_name: d.file_name,
					content: d.content,
				})),
				files,
				synced,
				...(memory && memory !== general && { memory }),
			});
		}
	}

	/** A session's events, oldest first, or null where a page of them didn't come or Stop came first:
	 * the API gives the newest first, a page at a time, so what's left out is its start, and a session
	 * without it would pass for the whole one. */
	async function eventsOf(org, id) {
		const events = new Map();
		let cursor = "";
		for (let page = 0; page < MAX_PAGES; page++) {
			if (stopped) return null;
			const got = await jsonOf(
				`/v1/code/sessions/${id}/events?limit=${EVENTS}${cursor && `&cursor=${encodeURIComponent(cursor)}`}`,
				code(org),
			);
			const list = got?.data;
			if (!Array.isArray(list)) return null;
			if (!list.length) break;
			const before = events.size;
			for (const e of list) events.set(e.event_id ?? e.sequence_num, e);
			cursor = got.resume_cursor;
			if (!cursor || events.size === before) break;
		}
		return [...events.values()].sort(
			(a, b) => Number(a.sequence_num) - Number(b.sequence_num),
		);
	}

	/** What a reply in a session says, thinks, and shows: the tools it ran have left their mark in
	 * what they did, and only those that write what the user asked for are read. */
	const SHOWN = new Set(["Write", "Edit", "SendUserFile", "SendUserMessage"]);

	/** A session's turns: the user's words and Claude's, and none of what its tools answered, nor a
	 * call its tool refused, which wrote nothing. */
	function turnsOf(events) {
		const refused = new Set();
		for (const e of events)
			for (const b of e.payload?.message?.content ?? [])
				if (b?.type === "tool_result" && b.is_error === true && b.tool_use_id)
					refused.add(b.tool_use_id);
		return events.flatMap((e) => {
			if (e.event_type !== "user" && e.event_type !== "assistant") return [];
			const said = e.payload?.message?.content;
			const at = e.payload?.timestamp ?? e.created_at;
			if (typeof said === "string")
				return said ? [{ role: e.event_type, at, content: said }] : [];
			if (!Array.isArray(said)) return [];
			const blocks = said
				.filter(
					(b) =>
						b.type === "text" ||
						b.type === "thinking" ||
						(b.type === "tool_use" && SHOWN.has(b.name) && !refused.has(b.id)),
				)
				.map(trimmed);
			return blocks.length ? [{ role: e.event_type, at, content: blocks }] : [];
		});
	}

	/** Every session a list asks for, once. It pages by the last answer's token, which an API that
	 * doesn't page by it ignores, giving back nothing new. */
	async function sessionRows(org, query) {
		const rows = new Map();
		let token = "";
		for (let page = 0; page < MAX_PAGES && !stopped; page++) {
			const got = await jsonOf(
				`/v1/code/sessions?${query}statuses=active&statuses=paused&statuses=failed&statuses=archived&limit=${PAGE}${token && `&cursor=${encodeURIComponent(token)}`}`,
				code(org),
			);
			if (!Array.isArray(got?.data)) {
				cut(page > 0);
				break;
			}
			const before = rows.size;
			for (const s of got.data) rows.set(s.id, s);
			token = got.resume_token ?? got.resume_cursor;
			if (!token || got.data.length < PAGE || rows.size === before) break;
		}
		return [...rows.values()];
	}

	/** The scheduled tasks of an org, what each asks, and when. */
	async function tasksOf(file, org) {
		const list =
			(await jsonOf(`/api/organizations/${org}/cowork/scheduled_tasks`))
				?.data ?? [];
		const ids = [];
		for (const task of list) {
			const t = task.trigger ?? task;
			if (!t.id) continue;
			ids.push(t.id);
			const prompt = t.derived_state?.prompt;
			if (prompt)
				file.tasks.push({
					name: t.name,
					prompt,
					enabled: t.enabled,
					schedule: { cron: t.cron_expression },
				});
		}
		return ids;
	}

	/** Code's sessions in the cloud and the runs of scheduled tasks, each as a chat. A session
	 * on the user's own computer is there alone. */
	async function sessionsOf(file, org, tasks) {
		const found = new Map();
		for (const s of await sessionRows(org, "")) found.set(s.id, s);
		for (const s of await sessionRows(org, "only_trigger_sessions=true&"))
			found.set(s.id, s);
		for (const id of tasks)
			for (const s of await sessionRows(org, `trigger_id=${id}&`))
				found.set(s.id, s);
		const list = [...found.values()];
		for (const [i, s] of list.entries()) {
			if (stopped) return;
			say("Reading your Code sessions…", `${i + 1} of ${list.length}.`);
			await roomy(file);
			const events = await eventsOf(org, s.id);
			// One read in part isn't saved as if whole: it's one that couldn't be read.
			if (!events) {
				if (!stopped) missed++;
				continue;
			}
			const turns = turnsOf(events);
			if (!turns.some((t) => t.role === "user")) continue;
			put(file.sessions, {
				id: s.id,
				title: s.title,
				created_at: s.created_at,
				...(s.trigger_id && { task: s.trigger_id }),
				turns,
			});
		}
	}

	/** A project that works in threads, as a list of its messages: those of its timeline, and each of
	 * its threads', with the bytes of what's attached; or null where a page of them didn't come or
	 * Stop came first, as one read in part would pass for the whole. */
	async function messagesOf(org, room) {
		const base = `/v1/code/channels/${room.id}`;
		const found = new Map();
		let cursor = "";
		for (let page = 0; page < MAX_PAGES && !stopped; page++) {
			const got = await jsonOf(
				`${base}/timeline?limit=${PAGE}${cursor && `&cursor=${encodeURIComponent(cursor)}`}`,
				code(org),
			);
			if (!Array.isArray(got?.data)) return null;
			const before = found.size;
			for (const m of got.data) found.set(m.id, m);
			cursor = got.next_cursor ?? got.cursor;
			if (!cursor || found.size === before) break;
		}
		const threads = await jsonOf(`${base}/threads`, code(org));
		if (!threads || stopped) return null;
		for (const section of threads.sections ?? [])
			for (const root of section.data ?? []) {
				found.set(root.id, root);
				const thread = await jsonOf(`${base}/threads/${root.id}`, code(org));
				if (!Array.isArray(thread?.data) || stopped) return null;
				for (const m of thread.data) found.set(m.id, m);
			}
		const messages = [];
		for (const m of found.values()) {
			const attachments = [];
			for (const a of m.attachments ?? []) {
				const got = await jsonOf(
					`${base}/attachments/${a.file_id}/content`,
					code(org),
				);
				const type = (got?.mime_type ?? a.mime_type ?? "").split(";")[0];
				const fits =
					typeof got?.data === "string" && Number(a.size_bytes) <= MAX_FILE;
				if (!fits && !stopped) left++;
				attachments.push({
					name: a.filename,
					data: fits ? await fitted(`data:${type};base64,${got.data}`) : null,
				});
			}
			messages.push({
				text: m.body,
				created_at: m.created_at,
				agent: !!m.author_agent_id,
				attachments,
			});
		}
		return messages;
	}

	/** The projects of an org that work in threads, which the user is in. */
	async function roomsOf(file, org) {
		const list =
			(await jsonOf(`/v1/code/channels?scope=joined&limit=${PAGE}`, code(org)))
				?.data ?? [];
		for (const [i, room] of list.entries()) {
			if (stopped) return;
			say("Reading your projects' threads…", `${i + 1} of ${list.length}.`);
			await roomy(file);
			// Read first: a file saved while they're read gives `file` new lists.
			const messages = await messagesOf(org, room);
			if (!messages) {
				if (!stopped) missed++;
				continue;
			}
			put(file.rooms, {
				channel_id: room.id,
				name: room.name,
				topic: room.topic,
				created_at: room.created_at,
				messages,
			});
		}
	}

	/** All of it, one org after another. An account in a team has that org's own chats too. */
	async function run() {
		const orgs = (await jsonOf("/api/organizations")) ?? [];
		const usable = Array.isArray(orgs)
			? orgs.filter((o) => (o.capabilities ?? []).includes("chat"))
			: [];
		if (!usable.length) {
			say("Sign in to Claude in this tab, then run the exporter again.");
			return;
		}
		say("Reading your settings…");
		const file = {
			format: "morse.claude-export",
			version: 1,
			exportedAt: new Date().toISOString(),
			source: "claude.ai",
			instructions: "",
			styles: [],
			memory: [],
			tasks: [],
			projects: [],
			rooms: [],
			sessions: [],
			chats: [],
		};
		current = file;
		const me = (await jsonOf("/api/account"))?.uuid;
		const profile = await jsonOf("/api/account_profile");
		file.instructions = profile?.conversation_preferences ?? "";
		for (const { uuid: org } of usable) {
			const styles = await jsonOf(`/api/organizations/${org}/list_styles`);
			for (const s of styles?.customStyles ?? [])
				if (s.prompt) file.styles.push({ name: s.name, prompt: s.prompt });
			const memory = await jsonOf(`/api/organizations/${org}/memory`);
			if (memory?.memory) file.memory.push(memory.memory);
			const tasks = await tasksOf(file, org);
			say("Reading your chats…");
			const rows = await chatsOf(org);
			await projectsOf(file, org, me, rows);
			for (const [i, row] of rows.entries()) {
				if (stopped) break;
				say("Reading your chats…", `Chat ${i + 1} of ${rows.length}.`);
				await roomy(file);
				const chat = await chatOf(org, row);
				if (chat) put(file.chats, chat);
			}
			if (!stopped) await roomsOf(file, org);
			if (!stopped) await sessionsOf(file, org, tasks);
			if (stopped) break;
		}
		// The last file says whether the run read all there was, for Morse to say so.
		file.partial = !!(stopped || missed || unlisted);
		await save(file);
		told(
			stopped
				? "Saved what was done."
				: unlisted
					? "Claude didn't list all of what's in your account, so this saved what it did. Run this again later for the rest."
					: `Done. Your ${total.files > 1 ? "files are" : "file is"} in your downloads.`,
		);
	}

	const count = (n, one) =>
		`${n.toLocaleString("en-US")} ${n === 1 ? one : `${one}s`}`;

	/** Says `what` and what's been saved, in every file so far, and how to bring it into Morse. */
	function told(what, after = "") {
		const several = total.files > 1;
		openMorse.style.display = "";
		const lost = [
			left && ` ${count(left, "file")} couldn't be saved.`,
			missed && ` ${count(missed, "chat")} couldn't be read.`,
		]
			.filter(Boolean)
			.join("");
		say(
			what,
			`${count(total.chats, "chat")} and ${count(total.messages, "message")}${several ? `, in ${total.files} files` : ""}.${lost} Now open Morse and choose ${several ? "them" : "it"} from your downloads, with the ZIPs of Claude's own export if you have them.${after}`,
		);
	}

	run()
		.catch(async (error) => {
			troubled = true;
			// What was read before it went wrong is saved, as Stop saves it, so it isn't lost with
			// what's left.
			if (current) current.partial = true;
			if (current) await save(current).catch(() => {});
			if (total.files)
				told(
					"Something went wrong partway, and this saved what was done.",
					` What went wrong: ${error}`,
				);
			else say("Something went wrong reading Claude.", String(error));
		})
		.finally(() => {
			window.__morseClaude.running = false;
			stopButton.style.display = "none";
			closeButton.style.display = "";
			if (troubled || left || missed || unlisted)
				reportButton.style.display = "";
			else if (total.files) quietReport.style.display = "";
		});
})();
