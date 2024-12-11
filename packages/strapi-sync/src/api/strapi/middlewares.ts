import { MiddlewareRoute } from "@medusajs/medusa";
import { hooksMiddlewares } from "./hooks/middlewares";
import { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { Modules } from "@medusajs/framework/utils";

export const strapiMiddlewares: MiddlewareRoute[] = [
  ...hooksMiddlewares,
  {
    method: ["POST", "OPTIONS"],
    matcher: /^\/strapi\/(hooks|contents)\/.*/,
    middlewares: [
      async (
        req: MedusaRequest,
        res: MedusaResponse,
        next: MedusaNextFunction
      ) => {
        const eventBus = req.scope.resolve(Modules.EVENT_BUS);

        console.info(`Received ${req.method} ${req.url} from ${req.ip}`);

        await eventBus.emit({ name: "strapi.request.received", data: req.url });
        next();
      },
    ],
  },
];
