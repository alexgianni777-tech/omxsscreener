/** Only the newest refresh may update a mounted view. */
export function createLatestRequestGuard() {
  let generation = 0;
  return {
    begin() {
      const started = ++generation;
      return () => generation === started;
    },
    invalidate() {
      generation++;
    },
  };
}