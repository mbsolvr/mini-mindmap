let serial = 0;
export function makeKey() {
  serial += 1;
  return `n-${Date.now().toString(36)}-${serial.toString(36)}`;
}
