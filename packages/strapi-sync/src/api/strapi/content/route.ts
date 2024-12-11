import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { parseCorsOrigins } from "@medusajs/framework/utils";

export const OPTIONS = async (req: MedusaRequest, res: MedusaResponse) => {
    const storeCors = req.app.get("config").projectConfig.storeCors || "http://localhost:8000";
    const adminCors = req.app.get("config").projectConfig.adminCors || "http://localhost:8000";
    const strapiCors = {
      origin: [...parseCorsOrigins(storeCors), ...parseCorsOrigins(adminCors)],
      credentials: true,
    };

  res.set(strapiCors); // Set CORS headers for preflight request
  res.sendStatus(200);
};
