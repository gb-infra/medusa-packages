import { defineMiddlewares } from "@medusajs/medusa";
import { adminMiddlewares } from "./admin/middlewares";
import { storeMiddlewares } from "./store/middlewares";
import { strapiMiddlewares } from "./strapi/middlewares";

export default defineMiddlewares({
  routes: [...adminMiddlewares, ...storeMiddlewares, ...strapiMiddlewares],
});
