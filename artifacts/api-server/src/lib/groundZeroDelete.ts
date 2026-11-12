import type { Request, Response } from "express";
import { DeleteGroundZeroSnapshotParams } from "@workspace/api-zod";

/** The repository atomically removes just this ID and returns the remaining state. */
export function createGroundZeroDeleteHandler(remove: (id: number) => Promise<unknown | null>) {
  return async (req: Request, res: Response): Promise<void> => {
    const parsed = DeleteGroundZeroSnapshotParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: "Ogiltigt avstämnings-ID." });
      return;
    }
    const state = await remove(parsed.data.id);
    if (state === null) {
      res.status(404).json({ error: "Avstämningen finns inte längre. Uppdatera listan." });
      return;
    }
    res.json(state);
  };
}
