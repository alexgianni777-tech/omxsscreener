/** Transport stays manual; only explicit user confirmation declares Telegram. */
export function pastedSignalSource(confirmedTelegram?: boolean): "telegram" | "manual" {
  return confirmedTelegram === true ? "telegram" : "manual";
}