// Gorgon Workbench — Skill Registry (Phase 3).
//
// The single, static registry of available Skills. No eval, no plugin market,
// no dynamic download (§4). New skills are added here by importing them — the
// list is built once at module load.
//
// Phase 4 will extend this with LLM-backed skills WITHOUT changing the
// registry shape; the Runner and Router stay unchanged.

import searchSkill from "./search-skill.js";
import extractSkill from "./extract-skill.js";
import summarizeSkill from "./summarize-skill.js";
import planSkill from "./plan-skill.js";
import writeSkill from "./write-skill.js";

const SKILLS = [searchSkill, extractSkill, summarizeSkill, planSkill, writeSkill];

const byId = new Map();
for (const s of SKILLS) {
  if (byId.has(s.id)) {
    // Defensive: duplicate id is a programming error, surface it loudly.
    throw new Error(`SkillRegistry: duplicate skill id "${s.id}"`);
  }
  byId.set(s.id, s);
}

/** Get a registered skill by id, or null. */
export function getSkill(id) {
  return byId.get(id) || null;
}

/** All registered skills (ordered). */
export function listSkills() {
  return SKILLS.slice();
}

/** All registered skill ids. */
export function listSkillIds() {
  return SKILLS.map((s) => s.id);
}

/** True if a skill with this id is registered. */
export function hasSkill(id) {
  return byId.has(id);
}

export const SKILL_IDS = listSkillIds();
export const SKILL_COUNT = SKILLS.length;
