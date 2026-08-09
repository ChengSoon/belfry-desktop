export function acceptSequence(expected: number, received: number) {
  if (received !== expected) {
    throw new Error(`terminal output sequence mismatch: expected ${expected}, received ${received}`);
  }
  return expected + 1;
}
