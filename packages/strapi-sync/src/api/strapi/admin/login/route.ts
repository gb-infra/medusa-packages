import * as jwt from "jsonwebtoken";
import { IUserModuleService } from "@medusajs/framework/types";
import {
  MedusaError,
  Modules,
  parseCorsOrigins,
} from "@medusajs/framework/utils";
import { MedusaRequest, MedusaResponse } from "@medusajs/framework";

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const userService = req.scope.resolve(Modules.USER) as IUserModuleService;
  const jwtSecret = req.app.get("config").projectConfig.http.jwtSecret;

  try {
    const user = await userService.restoreUsers(req.cookies.ajs_user_id);
    if (!user)
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        "Invalid request, no user found!"
      );

    delete user.password_hash; // Optionally remove password hash from the response
    const signedCookie = jwt.sign(JSON.stringify(user), jwtSecret);
    res.cookie("__medusa_session", signedCookie, { httpOnly: true });
    return res.sendStatus(200);
  } catch (error) {
    return res.status(500).send(JSON.stringify(error));
  }
};

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  res.clearCookie("__medusa_session");
  return res.sendStatus(200);
};

export const OPTIONS = async (req: MedusaRequest, res: MedusaResponse) => {
  const adminUrl = req.app.get("config").projectConfig.http.adminCors;
  const adminCors = {
    origin: parseCorsOrigins(adminUrl),
    credentials: true,
  };

  // Set CORS headers for preflight request
  res.set(adminCors);
  return res.sendStatus(200);
};
