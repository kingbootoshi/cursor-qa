const ansiPattern = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const oscPattern = /\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g;

export function cleanTerminalOutput(value: string): string {
  return value
    .replace(oscPattern, "")
    .replace(ansiPattern, "")
    .split("\n")
    .filter((line) => !line.includes("?25"))
    .join("\n")
    .trimEnd();
}
