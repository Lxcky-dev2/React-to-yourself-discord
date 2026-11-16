"use strict";

function readLocationId(rule, key, index) {
  const value = rule[key];
  if (value == null) return "";
  if (typeof value !== "string") {
    throw new Error(`keywordReactions[${index}].${key} must be a string (or left out).`);
  }
  return value.trim();
}

function createReactionMatcher(config) {
  const entries = config.keywordReactions ?? [];
  if (!Array.isArray(entries)) throw new Error("keywordReactions must be an array.");

  const rules = entries.map((rule, index) => {
    if (!rule || typeof rule !== "object") {
      throw new Error(`keywordReactions[${index}] must be an object with word and reaction.`);
    }
    const serverid = readLocationId(rule, "serverid", index);
    const dmid = readLocationId(rule, "dmid", index);
    if (serverid && dmid) {
      throw new Error(
        `keywordReactions[${index}] cannot have both serverid and dmid. Use one, or neither for every server and DM.` // make sure user cant set 2
      );
    }
    if (typeof rule.word !== "string" || !rule.word.trim()) {
      throw new Error(`keywordReactions[${index}] needs a non-empty word (string).`);
    }
    if (typeof rule.reaction !== "string" || !rule.reaction.trim()) {
      throw new Error(`keywordReactions[${index}] needs a non-empty reaction (string).`);
    }
//fucking regex is annoying 
    const word = rule.word.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return {
      serverid,
      dmid,
      reaction: rule.reaction.trim(),
      pattern: new RegExp(`(?<![\\p{L}\\p{N}_])${word}(?![\\p{L}\\p{N}_])`, "iu"),
    };
  });

  return (message, myId) => {
    if (!message.guild_id && config.ignoreDMs) return [];
    const reactions = new Set();

    if (myId && message.author?.id === myId && config.selfReact !== false) {
      reactions.add(config.emoji || "💀");
    }

    for (const rule of rules) {
      const inDM = !message.guild_id;
      const matchesLocation = rule.serverid
        ? message.guild_id === rule.serverid
        : rule.dmid
          ? inDM && message.channel_id === rule.dmid
          : true;
      if (matchesLocation && rule.pattern.test(message.content || "")) {
        reactions.add(rule.reaction);
      }
    }

    return [...reactions];
  };
}

module.exports = { createReactionMatcher }; //basically adding dm and server support so you can react to other user messages automatically 
