// services/aggregate_conversation.js
const UserResponse = require("../models/UserResponse");
const Conversation = require("../models/Conversation");
const { parseAspectsWithGPT } = require("./parse_aspects_gpt");

async function aggregateConversation(conversationId, userId) {
  try {
    const responses = await UserResponse.find({ conversationId, userId }).sort({ timestamp: 1 });
    if (!responses || responses.length === 0) return null;

    let decision = "";
    let options = [];
    let selfAspects = []; // array of { aspectName, preference }
    let feelings = "";
    let finalIdeaA = "";
    let finalIdeaB = "";
    let branch = ""; // "A" if user said yes at D, else "B"

    let prioritizedAspectAnswer = "";
    let prioritizedAspectName = "";

    for (const resp of responses) {
      const { questionKey, response } = resp;
      const trimmedResp = response.trim();

      switch (questionKey) {
        case "C1":
          decision = trimmedResp;
          break;
        case "C2":
          if (trimmedResp) {
            const arr = trimmedResp.split(/[,;]+/).map(x => x.trim()).filter(x => x);
            if (arr.length) options = arr;
          }
          break;
        case "D":
          branch = (trimmedResp.toLowerCase() === "yes") ? "A" : "B";
          break;

        // Branch A
        case "E":
          {
            const gptAspects = await parseAspectsWithGPT(trimmedResp);
            gptAspects.forEach(a => {
              selfAspects.push({
                aspectName: a.aspectName || "aspect",
                preference: a.preference || ""
              });
            });
          }
          break;
        case "E1":
        case "E2":
          // Additional clarifications (if any)
          break;
        case "F":
          feelings = trimmedResp;
          break;
        case "G":
          prioritizedAspectAnswer = trimmedResp;
          {
            let match = trimmedResp.match(/(selfish|confident|shy|laziness|[^\s]+(?: aspect)?)/i);
            if (match) {
              prioritizedAspectName = match[0].trim().toLowerCase();
            }
          }
          break;
        case "H":
          {
            // Check if user indicates no brainstormed idea.
            const lowerResp = trimmedResp.toLowerCase();
            if (
              lowerResp === "no" ||
              lowerResp.includes("no idea") ||
              lowerResp.includes("don't have any") ||
              lowerResp.includes("do not have any")
            ) {
              let matchedAspect = findAspectByName(selfAspects, prioritizedAspectName);
              if (matchedAspect && matchedAspect.preference) {
                finalIdeaA = stripPreface(matchedAspect.preference);
              } else {
                finalIdeaA = prioritizedAspectAnswer;
              }
            } else {
              // User provided a brainstormed idea – extract only the core option.
              finalIdeaA = extractOption(trimmedResp);
            }
          }
          break;
        case "H1":
          if (trimmedResp) finalIdeaA = extractOption(trimmedResp);
          break;
        case "I":
        case "I1":
          if (!finalIdeaA && trimmedResp) finalIdeaA = trimmedResp;
          break;

        // Branch B
        case "J":
          break;
        case "K":
          if (trimmedResp.toLowerCase().includes("self")) {
            let match = trimmedResp.match(/(.*?self)\s*(?:because)?\s*(.*)/i);
            if (match) {
              selfAspects.push({
                aspectName: match[1].trim(),
                preference: match[2].trim()
              });
            }
          } else {
            finalIdeaB = trimmedResp;
          }
          break;
        case "L":
          if (!feelings) feelings = trimmedResp;
          break;
        case "N":
          finalIdeaB = trimmedResp;
          break;
        case "I3":
          if (trimmedResp) finalIdeaB = trimmedResp;
          break;
        case "O":
          if (trimmedResp) {
            let asName = trimmedResp.replace(/^(with\s+)?(my\s+)?/i, "").trim();
            if (asName && !selfAspects.find(sa => sa.aspectName.toLowerCase() === asName.toLowerCase())) {
              selfAspects.push({ aspectName: asName, preference: "" });
            }
          }
          break;
        case "P":
          finalIdeaB = trimmedResp;
          break;
        case "I4":
          finalIdeaB = trimmedResp;
          break;
        default:
          break;
      }
    }

    const finalIdea = finalIdeaA || finalIdeaB || "";
    if (!decision) decision = "";
    if (!feelings) feelings = "";

    const conversationData = {
      conversationId,
      userId,
      decision,
      options,
      selfAspects,
      feelings,
      finalIdea,
      branch,
      createdAt: new Date()
    };

    const conversation = await Conversation.findOneAndUpdate(
      { conversationId, userId },
      conversationData,
      { upsert: true, new: true }
    );
    return conversation;
  } catch (error) {
    console.error("[Aggregate Conversation] Error:", error.message);
    throw error;
  }
}

/**
 * findAspectByName
 * 
 * Tries to find a self-aspect from the list by comparing the given name.
 */
function findAspectByName(selfAspects, aspectNameLower) {
  if (!aspectNameLower) return null;
  return selfAspects.find(sa =>
    sa.aspectName.toLowerCase().includes(aspectNameLower) ||
    aspectNameLower.includes(sa.aspectName.toLowerCase())
  );
}

/**
 * stripPreface
 * 
 * Removes common leading phrases like "prefers to", "wants to", or "would like to" from a given text.
 */
function stripPreface(text) {
  if (!text) return text;
  let cleaned = text.replace(/^(prefers to|wants to|would like to)\s*/i, "").trim();
  return capitalizeFirst(cleaned);
}

/**
 * extractOption
 * 
 * From a brainstormed idea, extract only the option name.
 * For example, from:
 * "I think going to the parks with exercising tools will make both sides happier"
 * return "going to the parks with exercising tools"
 */
function extractOption(text) {
  if (!text) return text;
  let lower = text.toLowerCase();
  // Remove common prefixes
  lower = lower.replace(/^(i think|i believe|maybe)\s+/i, "");
  // Remove trailing clause starting with "will" or "might"
  const index = lower.search(/\s+(will|might)\b/);
  if (index !== -1) {
    lower = lower.substring(0, index);
  }
  return capitalizeFirst(lower.trim());
}

function capitalizeFirst(str) {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

module.exports = { aggregateConversation };