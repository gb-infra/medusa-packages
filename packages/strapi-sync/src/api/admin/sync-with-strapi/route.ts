import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { UpdateStrapiService } from "@services";

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const updateStrapiService = req.scope.resolve(
    "updateStrapiService"
  ) as UpdateStrapiService;

  if (updateStrapiService.strapiSuperAdminAuthToken) {
    try {
      await updateStrapiService.executeSync(
        updateStrapiService.strapiSuperAdminAuthToken
      );
    } catch (e) {
      return res
        .sendStatus(500)
        .json({ statusCode: 500, message: "Something went wrong!" });
    }
    return res.sendStatus(200);
  } else {
    return res.status(500).send("Strapi server hasn't been initalised");
  }
};
