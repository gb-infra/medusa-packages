import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { UpdateStrapiService } from "@services";
import { AuthInterface, GetFromStrapiParams } from "@types";

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const updateStrapiService = req.scope.resolve(
      "updateStrapiService"
    ) as UpdateStrapiService;

    let authInterface: AuthInterface = {
      email: process.env.STRAPI_MEDUSA_EMAIL,
      password: process.env.STRAPI_MEDUSA_PASSWORD,
    };
    if (!authInterface.email)
      authInterface = updateStrapiService.defaultAuthInterface;

    const strapiEntityType = req.params.type;
    const urlParams = req.params;
    const urlQuery = req.query;

    const strapiParams: GetFromStrapiParams = {
      authInterface,
      strapiEntityType: strapiEntityType,
      urlParams,
      urlQuery,
    };

    const data = await updateStrapiService.getEntitiesFromStrapi(strapiParams);
    return res.send(data);
  } catch (error) {
    return res.status(500).json({ error: "Error fetching content" });
  }
};
