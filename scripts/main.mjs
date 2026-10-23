import { PICKS } from "./data.mjs";
import { CLASS_POWERS, CLASS_ABIL, GERAL, TORMENTA, SPELLS1, MUSICA } from "./extras.mjs";

const MOD = "origens-t20";
const RealDialogV2 = foundry.applications.api.DialogV2;
const DLG = ["origens-t20-dlg"];
/** DialogV2 com a classe de estilo do módulo (visual do kit Tormenta20). */
const DialogV2 = {
	wait: (cfg) => RealDialogV2.wait({ ...cfg, classes: [...DLG, ...(cfg.classes ?? [])] }),
	prompt: (cfg) => RealDialogV2.prompt({ ...cfg, classes: [...DLG, ...(cfg.classes ?? [])] }),
	confirm: (cfg) => RealDialogV2.confirm({ ...cfg, classes: [...DLG, ...(cfg.classes ?? [])] })
};

/* ------------------------------------------------------------------ */
/* Intercepta a origem arrastada para uma ficha                        */
/* ------------------------------------------------------------------ */
Hooks.on("preCreateItem", (item, data, options, userId) => {
	const actor = item.parent;
	if (!actor || actor.documentName !== "Actor") return;
	const origin = item.flags?.[MOD]?.origin ?? foundry.utils.getProperty(data, `flags.${MOD}.origin`);
	if (!origin) return;
	// Cancela a criação do "item origem" e abre o fluxo de escolha.
	setTimeout(() => {
		applyOrigin(actor, origin).catch((err) => {
			console.error("Origens (T20) |", err);
			ui.notifications.error("Origens (T20): não foi possível aplicar a origem. Veja o console (F12).");
		});
	}, 0);
	return false;
});

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const skillLabel = (id) => {
	const cfg = CONFIG.T20?.pericias?.[id];
	return cfg ? game.i18n.localize(cfg.label) : id;
};
const isTrained = (actor, id) => !!actor.system?.pericias?.[id]?.treinado;
const ownsPower = (actor, name) => actor.items.some((i) => i.type === "poder" && i.name === name);

async function addPowers(actor, uuids) {
	const created = [];
	const missing = [];
	const skipped = [];
	const datas = [];
	for (const uuid of uuids) {
		const src = await foundry.utils.fromUuid(uuid);
		if (!src) { missing.push(uuid); continue; }
		if (actor.items.some((i) => i.name === src.name && i.type === src.type)) { skipped.push(src.name); continue; }
		datas.push(game.items.fromCompendium(src));
		created.push(src.name);
	}
	if (datas.length) await actor.createEmbeddedDocuments("Item", datas);
	return { created, missing, skipped };
}

const STYLE = "";

const optionsHTML = (list, actor) => {
	const groups = new Map();
	for (const p of list) {
		const g = p.group ?? "";
		if (!groups.has(g)) groups.set(g, []);
		groups.get(g).push(p);
	}
	let html = "";
	for (const [g, items] of groups) {
		const opts = items.map((p) => `<option value="${esc(p.uuid)}"${ownsPower(actor, p.name) ? " disabled" : ""}>${esc(p.name)}${ownsPower(actor, p.name) ? " (já possui)" : ""}</option>`).join("");
		html += g ? `<optgroup label="${esc(g)}">${opts}</optgroup>` : opts;
	}
	return html;
};

/* ------------------------------------------------------------------ */
/* Fluxo principal                                                     */
/* ------------------------------------------------------------------ */
async function applyOrigin(actor, o) {
	if (!actor.isOwner) return ui.notifications.warn("Você não tem permissão para alterar esta ficha.");
	if (o.kind === "single") return applySingle(actor, o);
	const picks = o.kind === "gm" ? await askGM(actor, o) : await askChoice(actor, o);
	if (!picks) return;
	await commit(actor, o, picks);
}

async function applySingle(actor, o) {
	const steps = FOLLOWUPS[norm(o.name)] ?? [];
	let extra = null;
	if (steps.length) {
		extra = await askFollow(actor, o, steps);
		if (!extra) return; // cancelado: nada é aplicado
	}
	const res = await addPowers(actor, [o.power.uuid]);
	if (res.missing.length) {
		return DialogV2.prompt({
			window: { title: "Origem: poder não encontrado" },
			content: `<div class="origens-t20"><p>Não encontrei o poder <strong>${esc(o.power.name)}</strong>. Esta origem usa os poderes do módulo <strong>Suplementos de Arton</strong>. Verifique se ele está instalado e ativo neste mundo.</p></div>`,
			ok: { label: "Entendi" }
		});
	}
	await actor.update({ "system.detalhes.origem": o.name });
	const notes = extra ? await applyFollow(actor, o, extra) : [];
	if (res.skipped.length) ui.notifications.warn(`Origem ${o.name}: o personagem já tinha o poder ${res.skipped[0]}.${notes.length ? " " + notes.join(" ") : ""}`);
	else ui.notifications.info(`Origem ${o.name} aplicada: poder ${res.created[0]} adicionado.${notes.length ? " " + notes.join(" ") : ""}`);
}

/* ------------------------------------------------------------------ */
/* Escolhas extras das origens de poder único                          */
/* (atributo, poder, magia, perícia, habilidade de outra classe...)    */
/* ------------------------------------------------------------------ */
const norm = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const ATTRS = [["for", "Força"], ["des", "Destreza"], ["con", "Constituição"], ["int", "Inteligência"], ["sab", "Sabedoria"], ["car", "Carisma"]];
const ownsAny = (actor, name) => actor.items.some((i) => i.name === name);
const classItems = (actor) => actor.items.filter((i) => i.type === "classe");
const classLevels = (actor, name) => classItems(actor).filter((i) => i.name === name || norm(i.name) === norm(name)).reduce((n, i) => n + Number(i.system?.niveis ?? 0), 0);
const craftSkills = () => Object.entries(CONFIG.T20?.pericias ?? {}).filter(([id, c]) => c.crafting || /^of/.test(id)).map(([id]) => id);

/** Poderes das classes do personagem (ou de todas as classes, se ele ainda não tiver nenhuma). */
const ownClassPowers = (actor, minLevels = 0) => {
	const names = classItems(actor).map((c) => c.name).filter((n) => CLASS_POWERS[n] && classLevels(actor, n) >= minLevels);
	const use = names.length ? names : (minLevels ? [] : Object.keys(CLASS_POWERS));
	return use.flatMap((n) => CLASS_POWERS[n]);
};

const FOLLOWUPS = {
	[norm("Aspirante a herói")]: [{ id: "attr", type: "attr", label: "Atributo que recebe +1" }],
	[norm("Cosmopolita")]: [{ id: "poder", type: "power", label: "Poder geral ou de uma classe com 2+ níveis", list: (a) => [...GERAL, ...ownClassPowers(a, 2)] }],
	[norm("Futura Lenda")]: [{ id: "poder", type: "power", label: "Poder de uma de suas classes", list: (a) => ownClassPowers(a) }],
	[norm("Estandarte Vivo")]: [{ id: "poder", type: "power", label: "Poder de combate ou da Tormenta", list: () => [...PICKS.combate, ...TORMENTA] }],
	[norm("Menestrel")]: [{ id: "poder", type: "power", label: "Música de bardo", list: () => MUSICA }],
	[norm("Estudante da Academia")]: [{ id: "magia", type: "power", label: "Magia arcana de 1º círculo (atributo-chave Inteligência)", list: () => SPELLS1.filter((x) => x.t === "arc") }],
	[norm("De Outro Mundo")]: [
		{ id: "magia", type: "power", label: "Magia de 1º círculo", list: () => SPELLS1 },
		{ id: "chave", type: "text-select", label: "Atributo-chave da magia", options: ATTRS }
	],
	[norm("Duplo Feérico")]: [{ id: "poder", type: "power", label: "Habilidade de 1º nível de outra classe", list: (a) => {
		const own = classItems(a).map((c) => norm(c.name));
		return Object.entries(CLASS_ABIL).filter(([n]) => !own.includes(norm(n))).flatMap(([n, l]) => l.map((x) => ({ ...x, group: n })));
	} }],
	[norm("Citadino Abastado")]: [{ id: "oficio", type: "skill", label: "Ofício em que é treinado", skills: () => craftSkills() }],
	[norm("Espião")]: [{ id: "pericia", type: "skill", label: "Perícia que usa Carisma como atributo-chave", skills: () => Object.keys(CONFIG.T20?.pericias ?? {}).filter((id) => !["luta", "pont"].includes(id)) }]
};

/** Linha de uma etapa extra. */
function followRow(actor, step) {
	if (step.type === "attr") {
		return `<label class="row"><span>${esc(step.label)}</span><select name="${step.id}">${ATTRS.map(([k, n]) => `<option value="${k}">${n}</option>`).join("")}</select></label>`;
	}
	if (step.type === "text-select") {
		return `<label class="row"><span>${esc(step.label)}</span><select name="${step.id}">${step.options.map(([k, n]) => `<option value="${k}">${n}</option>`).join("")}</select></label>`;
	}
	if (step.type === "skill") {
		const opts = step.skills(actor).map((id) => ({ id, label: skillLabel(id) })).sort((a, b) => a.label.localeCompare(b.label, "pt"));
		return `<label class="row"><span>${esc(step.label)}</span><select name="${step.id}">${opts.map((s) => `<option value="${s.id}"${isTrained(actor, s.id) && step.id === "oficio" ? " disabled" : ""}>${esc(s.label)}${isTrained(actor, s.id) && step.id === "oficio" ? " (treinado)" : ""}</option>`).join("")}</select></label>`;
	}
	const list = step.list(actor);
	if (!list.length) return `<p class="hint">${esc(step.label)}: nenhuma opção disponível agora (adicione a classe primeiro, ou escolha depois pela ficha).</p>`;
	return `<div class="row-block"><span>${esc(step.label)}</span><input type="search" class="filter" data-for="${step.id}" placeholder="Pesquisar..."><select name="${step.id}" size="1">${optionsHTML(list, actor)}</select></div>`;
}

function wireFilters(root) {
	for (const inp of root.querySelectorAll("input.filter")) {
		const sel = root.querySelector(`select[name="${inp.dataset.for}"]`);
		inp.addEventListener("input", () => {
			const q = norm(inp.value); let first = null;
			for (const op of sel.querySelectorAll("option")) {
				const hit = !q || norm(op.textContent).includes(q);
				op.hidden = !hit; if (hit && !op.disabled && !first) first = op;
			}
			for (const g of sel.querySelectorAll("optgroup")) g.hidden = ![...g.querySelectorAll("option")].some((o) => !o.hidden);
			if (first && (sel.selectedOptions[0]?.hidden || sel.selectedOptions[0]?.disabled)) sel.value = first.value;
		});
	}
}

async function askFollow(actor, o, steps) {
	const content = `<div class="origens-t20"><p>A origem <strong>${esc(o.name)}</strong> pede uma escolha:</p><fieldset><legend>Escolhas da origem</legend>${steps.map((st) => followRow(actor, st)).join("")}</fieldset></div>`;
	return DialogV2.wait({
		window: { title: `Origem: ${o.name}`, icon: "fa-solid fa-scroll" },
		position: { width: 480 },
		content,
		modal: true,
		rejectClose: false,
		render: (event, dialog) => wireFilters(dialog.element),
		buttons: [
			{
				action: "ok", label: "Confirmar", icon: "fa-solid fa-check", default: true,
				callback: (event, button, dialog) => {
					const out = {};
					for (const st of steps) { const sel = dialog.element.querySelector(`select[name="${st.id}"]`); if (sel) out[st.id] = sel.value; }
					return out;
				}
			},
			{ action: "cancel", label: "Cancelar", icon: "fa-solid fa-xmark", callback: () => null }
		]
	});
}

/** Aplica as escolhas extras. Devolve mensagens para a notificação. */
async function applyFollow(actor, o, v) {
	const notes = [];
	const key = norm(o.name);
	if (key === norm("Aspirante a herói") && v.attr) {
		const label = ATTRS.find(([k]) => k === v.attr)?.[1] ?? v.attr;
		const cur = Number(foundry.utils.getProperty(actor, `system.atributos.${v.attr}.base`) ?? 0);
		await actor.update({ [`system.atributos.${v.attr}.base`]: cur + 1 });
		notes.push(`+1 em ${label}.`);
	}
	if (v.poder || v.magia) {
		const uuids = [v.poder, v.magia].filter(Boolean);
		const res = await addPowers(actor, uuids);
		if (res.created.length) notes.push(`Adicionado: ${res.created.join(", ")}.`);
		if (res.skipped.length) notes.push(`Já possuía: ${res.skipped.join(", ")}.`);
		if (key === norm("Duplo Feérico") && res.created.some((n) => /^magias/i.test(n))) notes.push("Habilidade Magias: aprenda uma única magia e some +1 PM manualmente.");
	}
	if (v.chave) notes.push(`Atributo-chave da magia: ${ATTRS.find(([k]) => k === v.chave)?.[1]}.`);
	if (v.oficio) {
		await actor.update({ [`system.pericias.${v.oficio}.treinado`]: true });
		notes.push(`Treinado em ${skillLabel(v.oficio)}.`);
	}
	if (v.pericia) {
		await actor.update({ [`system.pericias.${v.pericia}.atributo`]: "car" });
		notes.push(`${skillLabel(v.pericia)} agora usa Carisma.`);
	}
	return notes;
}

/* ---- escolha de 2 benefícios (Livro Básico) ---- */
async function askChoice(actor, o) {
	const skillRows = o.skills.map((s, i) => {
		if (s.choose) {
			const opts = s.choose.map((id) => `<option value="${id}"${isTrained(actor, id) ? " disabled" : ""}>${esc(skillLabel(id))}${isTrained(actor, id) ? " (treinado)" : ""}</option>`).join("");
			return `<label class="row"><input type="checkbox" data-type="skill" data-key="s${i}"> <span>${esc(s.label)}</span><select data-for="s${i}" disabled>${opts}</select></label>`;
		}
		const done = isTrained(actor, s.id);
		return `<label class="row${done ? " muted" : ""}"><input type="checkbox" data-type="skill" data-key="s${i}" data-id="${s.id}"${done ? " disabled data-locked" : ""}> <span>${esc(skillLabel(s.id))}</span>${done ? '<span class="tag">(já treinado)</span>' : ""}</label>`;
	}).join("");
	const powerRows = o.powers.map((p, i) => {
		if (p.pick) {
			return `<label class="row"><input type="checkbox" data-type="pick" data-key="p${i}"> <span>${esc(p.label)}</span><select data-for="p${i}" disabled>${optionsHTML(PICKS[p.pick], actor)}</select></label>`;
		}
		const done = ownsPower(actor, p.name);
		return `<label class="row${done ? " muted" : ""}"><input type="checkbox" data-type="power" data-key="p${i}" data-uuid="${esc(p.uuid)}"${done ? " disabled data-locked" : ""}> <span>${esc(p.name)}</span>${p.unique ? '<span class="tag">(poder único da origem)</span>' : ""}${done ? '<span class="tag">(já possui)</span>' : ""}</label>`;
	}).join("");
	const content = `${STYLE}<div class="origens-t20"><p>Escolha <strong>2 benefícios</strong> da origem <strong>${esc(o.name)}</strong>. <span class="count">0/2</span></p>
<fieldset><legend>Perícias (ficam treinadas)</legend>${skillRows}</fieldset>
<fieldset><legend>Poderes (adicionados à ficha)</legend>${powerRows}</fieldset></div>`;
	const available = o.skills.filter((s) => s.choose || !isTrained(actor, s.id)).length + o.powers.filter((p) => p.pick || !ownsPower(actor, p.name)).length;
	const need = Math.min(2, available);
	return DialogV2.wait({
		window: { title: `Origem: ${o.name}`, icon: "fa-solid fa-scroll" },
		position: { width: 460 },
		content,
		modal: true,
		rejectClose: false,
		render: (event, dialog) => wireChoice(dialog.element, need),
		buttons: [
			{
				action: "ok", label: "Confirmar", icon: "fa-solid fa-check", default: true,
				callback: (event, button, dialog) => {
					const root = dialog.element;
					const out = [];
					for (const cb of root.querySelectorAll("input[type=checkbox]:checked")) {
						const key = cb.dataset.key;
						const sel = root.querySelector(`select[data-for="${key}"]`);
						if (cb.dataset.type === "skill") out.push({ type: "skill", id: sel ? sel.value : cb.dataset.id });
						else if (cb.dataset.type === "pick") out.push({ type: "power", uuid: sel.value });
						else out.push({ type: "power", uuid: cb.dataset.uuid });
					}
					return out;
				}
			},
			{ action: "cancel", label: "Cancelar", icon: "fa-solid fa-xmark", callback: () => null }
		]
	});
}

function wireChoice(root, need) {
	const boxes = [...root.querySelectorAll("input[type=checkbox]")];
	const ok = root.querySelector('button[data-action="ok"]');
	const counter = root.querySelector(".count");
	const refresh = () => {
		const n = boxes.filter((b) => b.checked).length;
		for (const b of boxes) {
			if (b.dataset.locked !== undefined) continue;
			b.disabled = !b.checked && n >= need;
		}
		for (const sel of root.querySelectorAll("select[data-for]")) {
			const cb = root.querySelector(`input[data-key="${sel.dataset.for}"]`);
			sel.disabled = !cb.checked;
			if (cb.checked && sel.selectedOptions[0]?.disabled) {
				const first = [...sel.options].find((op) => !op.disabled);
				if (first) sel.value = first.value;
			}
		}
		counter.textContent = `${n}/${need}`;
		if (ok) ok.disabled = n !== need;
	};
	boxes.forEach((b) => b.addEventListener("change", refresh));
	refresh();
}

/* ---- Amnésico: o mestre escolhe uma perícia e um poder ---- */
async function askGM(actor, o) {
	const allSkills = Object.keys(CONFIG.T20.pericias).filter((id) => !CONFIG.T20.pericias[id].crafting || true);
	const sk = allSkills
		.map((id) => ({ id, label: skillLabel(id) }))
		.sort((a, b) => a.label.localeCompare(b.label, "pt"))
		.map((s) => `<option value="${s.id}"${isTrained(actor, s.id) ? " disabled" : ""}>${esc(s.label)}${isTrained(actor, s.id) ? " (treinado)" : ""}</option>`).join("");
	const content = `${STYLE}<div class="origens-t20"><p>Origem <strong>${esc(o.name)}</strong>: em vez de dois benefícios de uma lista, o personagem recebe uma perícia e um poder escolhidos pelo mestre, e o poder <strong>${esc(o.unique.name)}</strong> (adicionado automaticamente).</p>
<fieldset><legend>Perícia (fica treinada)</legend><label class="row"><select name="skill">${sk}</select></label></fieldset>
<fieldset><legend>Poder geral</legend><label class="row"><select name="power">${optionsHTML(PICKS.geral, actor)}</select></label></fieldset></div>`;
	return DialogV2.wait({
		window: { title: `Origem: ${o.name}`, icon: "fa-solid fa-scroll" },
		position: { width: 460 },
		content,
		modal: true,
		rejectClose: false,
		buttons: [
			{
				action: "ok", label: "Confirmar", icon: "fa-solid fa-check", default: true,
				callback: (event, button, dialog) => {
					const root = dialog.element;
					return [
						{ type: "skill", id: root.querySelector('select[name="skill"]').value },
						{ type: "power", uuid: root.querySelector('select[name="power"]').value },
						{ type: "power", uuid: o.unique.uuid }
					];
				}
			},
			{ action: "cancel", label: "Cancelar", icon: "fa-solid fa-xmark", callback: () => null }
		]
	});
}

/* ---- aplica as escolhas ---- */
async function commit(actor, o, picks) {
	const upd = { "system.detalhes.origem": o.name };
	const skills = [];
	const uuids = [];
	for (const p of picks) {
		if (p.type === "skill") { upd[`system.pericias.${p.id}.treinado`] = true; skills.push(skillLabel(p.id)); }
		else uuids.push(p.uuid);
	}
	await actor.update(upd);
	const res = await addPowers(actor, uuids);
	const parts = [];
	if (skills.length) parts.push(`treinado em ${skills.join(", ")}`);
	if (res.created.length) parts.push(`poder(es) ${res.created.join(", ")}`);
	ui.notifications.info(`Origem ${o.name} aplicada: ${parts.join(" e ")}.`);
	if (res.missing.length) ui.notifications.error("Alguns poderes não foram encontrados nos compêndios do sistema.");
	if (res.skipped.length) ui.notifications.warn(`O personagem já tinha: ${res.skipped.join(", ")}.`);
}

/* ------------------------------------------------------------------ */
/* Rede de segurança: se o compêndio estiver vazio, o GM o preenche    */
/* a partir de data/origens.json.                                      */
/* ------------------------------------------------------------------ */
Hooks.once("ready", async () => {
	if (!game.user.isGM) return;
	const pack = game.packs.get(`${MOD}.origens`);
	if (!pack || pack.index.size > 0) return;
	try {
		const data = await (await fetch(`modules/${MOD}/data/origens.json`)).json();
		if (pack.locked) await pack.configure({ locked: false });
		const opts = { pack: pack.collection, keepId: true };
		await Folder.createDocuments(data.folders, opts);
		await Item.createDocuments(data.items, opts);
		console.log("Origens (T20) | Compêndio preenchido a partir de data/origens.json.");
	} catch (err) {
		console.error("Origens (T20) | Falha ao preencher o compêndio:", err);
		ui.notifications.error("Origens (T20): falha ao preencher o compêndio. Veja o console.");
	}
});

/* Garante o estilo mesmo se o Foundry não tiver carregado o CSS do module.json. */
Hooks.once("init", () => {
	const href = `modules/${MOD}/styles/origens.css`;
	if ([...document.styleSheets].some((s) => s.href?.includes("origens-t20/styles/origens.css"))) return;
	const link = document.createElement("link");
	link.rel = "stylesheet"; link.href = href;
	document.head.appendChild(link);
});
