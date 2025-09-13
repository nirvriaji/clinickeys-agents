// packages/core/src/utils/generateInstructions.ts

import fs from "fs";
import path from "path";

export function generateInstructions(
  assistantName: string,
  placeholders: Record<string, string> = {}
): string {
  const templateDir = path.resolve(
    __dirname, "packages/core/src/.ia/instructions/templates"
  );
  const fileName = `${assistantName}.md`;
  const templatePath = path.join(templateDir, fileName);

  let md: string;
  try {
    md = fs.readFileSync(templatePath, "utf8");
  } catch (err) {
    throw new Error(
      `No se pudo leer el template de instrucciones '${fileName}' en ${templateDir}: ${err}`
    );
  }

  // Reemplazo de placeholders tipo [KEY]
  return md.replace(/\[([A-Z0-9_]+)]/g, (_, key) =>
    Object.prototype.hasOwnProperty.call(placeholders, key)
      ? placeholders[key]
      : `[${key}]`
  );
}

export function generateInstructionsRaw(assistantName: string): string {
  const templateDir = path.resolve(
    __dirname,
    "packages/core/src/.ia/instructions/templates"
  );
  const fileName = `${assistantName}.md`;
  const templatePath = path.join(templateDir, fileName);

  try {
    return fs.readFileSync(templatePath, "utf8");
  } catch (err) {
    throw new Error(
      `No se pudo leer el template de instrucciones '${fileName}' en ${templateDir}: ${err}`
    );
  }
}

/**
 * Convierte los placeholders de configuración en un bloque de contexto legible.
 * Esto permite pasarlos al assistant como parte del mensaje del usuario
 * (en RecognizeUserIntent y CommunicateWithAssistant).
 */
export function mergePlaceholdersIntoContext(
  placeholders: Record<string, string | undefined> = {}
): string {
  if (!placeholders || Object.keys(placeholders).length === 0) {
    return "";
  }

  const entries = Object.entries(placeholders)
    .filter(([_, value]) => value != null && value !== "")
    .map(([key, value]) => `${key}: ${value}`);

  if (entries.length === 0) {
    return "";
  }

  return `\n\n=== CONTEXTO_PLACEHOLDERS ===\n${entries.join("\n")}\n============================\n`;
}
