import { Router } from "express";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { asyncHandler } from "../middlewares/asyncHandler";
import { globalSearch } from "../services/search.service";

const router = Router();
router.use(requireAuth);

router.get(
  "/search",
  asyncHandler(async (req: AuthRequest, res) => {
    const q = ((req.query.q as string) ?? "").trim();
    res.json(await globalSearch(req, q));
  }),
);

export default router;
