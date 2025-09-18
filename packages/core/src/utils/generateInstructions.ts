import fs from "fs";
import path from "path";

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