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