import * as jwt from "jsonwebtoken";
import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import {
  FindConfig,
  ProductCollectionDTO,
  ProductDTO,
} from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import {
  StrapiSeedInterface,
  StrapiSignalInterface,
  UpdateMedusaDataInterface,
} from "@types";
import { UpdateMedusaService, UpdateStrapiService } from "@services";
import {
  transformMedusaToStrapiProduct,
  translateIdsToMedusaIds,
} from "@utils";
import {
  productCollectionFields,
  productFields,
  productRelations,
  regionFields,
  regionRelations,
  shippingOptionFields,
  shippingOptionRelations,
  shippingProfileFields,
  shippingProfileRelations,
  storeFields,
  storeRelations,
} from "@constants";

export const POST = async (req: MedusaRequest<any>, res: MedusaResponse) => {
  const eventBus = req.scope.resolve(Modules.EVENT_BUS);
  const config = req.scope.resolve(ContainerRegistrationKeys.CONFIG_MODULE);
  const medusaSecret = config.projectConfig.http.jwtSecret;
  if (!medusaSecret)
    throw new Error("Invalid request, jwt secret are missing!");

  try {
    const message = req.body["signedMessage"];
    const decodedMessage = jwt.verify(
      message,
      medusaSecret
    ) as StrapiSignalInterface;
    req["decodedMessage"] = decodedMessage;
    switch (decodedMessage.message) {
      case "SYNC COMPLETED":
        await eventBus.emit({
          data: decodedMessage,
          name: "strapi.sync-completed",
        });
        console.debug("valid strapi sync completed");
        return res.sendStatus(200);
      case "STATUS UPDATE":
        await eventBus.emit({
          name: "strapi.status.update",
          data: decodedMessage,
        });
        console.debug("valid update strapi status message received");
        return res.sendStatus(200);
      case "SEED": {
        console.debug("valid strapi seed request received");
        try {
          const updateStrapiService = req.scope.resolve(
            "updateStrapiService"
          ) as UpdateStrapiService;
          const pageLimit = updateStrapiService.options_.max_page_size ?? 50;
          const productModuleService = req.scope.resolve(Modules.PRODUCT);
          const regionModuleService = req.scope.resolve(Modules.REGION);

          const pageNumber = decodedMessage?.data?.meta?.pageNumber ?? 1;
          console.info(`received request for page ${pageNumber} from Strapi`);
          const paymentModuleService = req.scope.resolve(Modules.PAYMENT);
          const fulfillmentModuleService = req.scope.resolve(
            Modules.FULFILLMENT
          );

          const storeService = req.scope.resolve(Modules.STORE);

          const productCollectionRelations = ["products"];
          // Fetching all entries at once. Can be optimized
          const productCollectionListConfig: FindConfig<ProductCollectionDTO> =
            {
              skip: (pageNumber - 1) * pageLimit,
              take: pageLimit,
              select: productCollectionFields,
              relations: productCollectionRelations,
            };

          const productListConfig: FindConfig<ProductDTO> = {
            skip: (pageNumber - 1) * pageLimit,
            take: pageLimit,
            select: productFields,
            relations: productRelations,
          };
          const regionListConfig = {
            skip: (pageNumber - 1) * pageLimit,
            take: pageLimit,
            select: regionFields,
            relations: regionRelations,
          };
          const shippingOptionsConfig = {
            skip: (pageNumber - 1) * pageLimit,
            take: pageLimit,
            select: shippingOptionFields,
            relations: shippingOptionRelations,
          };
          const shippingProfileConfig = {
            skip: (pageNumber - 1) * pageLimit,
            take: pageLimit,
            select: shippingProfileFields,
            relations: shippingProfileRelations,
          };

          const storeConfig = {
            skip: (pageNumber - 1) * pageLimit,
            take: pageLimit,
            select: storeFields,
            relations: storeRelations,
          };

          const pagedProductCollections =
            await productModuleService.listProductCollections(
              {},
              productCollectionListConfig
            );

          const pagedRegions = await regionModuleService.listRegions(
            {},
            regionListConfig
          );
          const pagedProducts = await productModuleService.listProducts(
            {},
            productListConfig
          );
          const productsToTransform = pagedProducts.map(async (product) => {
            return await transformMedusaToStrapiProduct(product);
          });
          const transformedPagedProducts = await Promise.all(
            productsToTransform
          );
          const pagedPaymentProviders =
            await paymentModuleService.listPaymentProviders();
          const pagedFulfillmentProviders =
            await fulfillmentModuleService.listFulfillmentProviders();
          const pagedShippingOptions =
            await fulfillmentModuleService.listShippingOptions(
              {},
              shippingOptionsConfig
            );
          const pagedShippingProfiles =
            await fulfillmentModuleService.listShippingProfiles(
              {},
              shippingProfileConfig
            );

          const pagedStores = await storeService.listStores({}, storeConfig);

          const response: Record<string, any[]> = {
            productCollections: pagedProductCollections,
            products: transformedPagedProducts,
            regions: pagedRegions,
            paymentProviders: pagedPaymentProviders as any,
            fulfillmentProviders: pagedFulfillmentProviders as any,
            shippingOptions: pagedShippingOptions,
            shippingProfiles: pagedShippingProfiles,
            stores: Array.isArray(pagedStores) ? pagedStores : [pagedStores],
          };

          await translateIdsToMedusaIds(response);
          const seedResponse: StrapiSeedInterface = {
            meta: {
              pageNumber,
              pageLimit,
              hasMore: {
                productCollections: pagedProductCollections.length == pageLimit,
                products: pagedProducts.length == pageLimit,
                regions: pagedRegions.length == pageLimit,
                paymentProviders: pagedPaymentProviders.length == pageLimit,
                fulfillmentProviders:
                  pagedFulfillmentProviders.length == pageLimit,
                shippingOptions: pagedShippingOptions.length == pageLimit,
                shippingProfiles: pagedShippingProfiles.length == pageLimit,
              },
            },
            data: response,
          };

          return res.status(200).send(seedResponse);
        } catch (error) {
          return res.status(400).send(`Webhook error: ${error.message}`);
        }
      }

      case "UPDATE MEDUSA": {
        const updateMedusaService = req.scope.resolve(
          "updateMedusaService"
        ) as UpdateMedusaService;
        try {
          const signedMessage = req.body["signedMessage"];
          const signalRequest = jwt.verify(
            signedMessage,
            medusaSecret
          ) as StrapiSignalInterface;
          const body = signalRequest.data as UpdateMedusaDataInterface;

          // find Strapi entry type from body of webhook
          const strapiType = body.type;
          const origin = body.origin;
          // get the ID
          let entryId: string;

          if (origin == "medusa") {
            console.info("received update confirmation");
            return res.sendStatus(200);
          }

          let updated = {};
          switch (strapiType) {
            case "product":
              entryId = body.data.medusa_id;
              updated = await updateMedusaService.sendStrapiProductToMedusa(
                body.data,
                entryId
              );
              break;
            case "productVariant":
              entryId = body.data.medusa_id;
              updated =
                await updateMedusaService.sendStrapiProductVariantToMedusa(
                  body.data,
                  entryId
                );
              break;
            case "region":
              entryId = body.data.medusa_id;
              updated = await updateMedusaService.sendStrapiRegionToMedusa(
                body.data,
                entryId
              );
              break;
            default:
              break;
          }

          return res.status(200).send(updated);
        } catch (error) {
          return res.status(400).send(`Webhook error: ${error.message}`);
        }
      }

      default:
        await eventBus.emit({ name: "strapi.message", data: decodedMessage });
        console.debug("valid strapi status message received");
        return res.sendStatus(200);
    }
  } catch (e) {
    console.error("Error occur while receiving strapi signal.", {
      "error.message": e.message,
    });
    return res
      .status(500)
      .send("Error occur while receiving strapi signal - " + e.message);
  }
};
