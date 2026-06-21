let verboseEnabled = false;

export function setVerbose(enabled: boolean): void {
  verboseEnabled = enabled;
}

export function log(message: string): void {
  console.error(message);
}

export function verbose(message: string): void {
  if (verboseEnabled) {
    console.error(`[verbose] ${message}`);
  }
}

export function error(message: string): void {
  console.error(`Error: ${message}`);
}
