import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { parseCorsOrigins } from "@medusajs/framework/utils";

export const OPTIONS = async (req: MedusaRequest, res: MedusaResponse) => {
  const strapiUrl = req.app.get("config").projectConfig.strapi_url;
  const strapiCors = {
    origin: parseCorsOrigins(strapiUrl),
    credentials: true,
  };

  res.set(strapiCors); // Set CORS headers for preflight request
  res.sendStatus(200);
};
