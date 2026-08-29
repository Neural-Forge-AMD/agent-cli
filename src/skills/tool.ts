/**
 * Tool handler for load_skill allowing the LLM to retrieve full skill instructions.
 */

import type { Tool } from "../tools/types";
import type { SkillsLoader } from "./loader";

export function createSkillTool(loader: SkillsLoader): Tool {
  return {
    name: "load_skill",
    description: "Load detailed instructions and guidelines for a specialized skill workflow.",
    parameters: {
      type: "object",
      properties: {
        skill_name: {
          type: "string",
          description: "Name of the skill to load (from available skills list).",
        },
      },
      required: ["skill_name"],
    },
    async execute(args, context) {
      const skillName = String(args.skill_name || "");
      const loaded = loader.loadSkill(context.cwd, skillName);

      if (!loaded) {
        return {
          output: `Skill '${skillName}' not found. Check available skills list.`,
          isError: true,
        };
      }

      return {
        output: `# Skill: ${loaded.name}\n${loaded.description}\n\n${loaded.instructions}`,
      };
    },
  };
}
