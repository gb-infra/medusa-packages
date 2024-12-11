import { MiddlewareRoute } from "@medusajs/medusa";
import rateLimit from "express-rate-limit";

export const hooksMiddlewares: MiddlewareRoute[] = [
  {
    method: ["POST", "OPTIONS"],
    matcher: "/strapi/hooks",
    middlewares: [
      rateLimit({
        max: parseInt(process.env.STAPI_HOOKS_MAX_REQUESTS ?? "100") || 100,
        windowMs:
          parseInt(process.env.STAPI_HOOKS_MAX_DELAY ?? "100000") || 100000, // 100 seconds
        message:
          "You can't make any more requests at the moment. Try again later",
      }),
    ],
  },
];
