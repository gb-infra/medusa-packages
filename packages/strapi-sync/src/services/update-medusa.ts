import { addIgnore_, shouldIgnore_ } from "../utils/redis-key-manager";
import { MedusaService } from "@medusajs/framework/utils";
import {
  IProductModuleService,
  IRegionModuleService,
  Logger,
} from "@medusajs/framework/types";

function isEmptyObject(obj): boolean {
  // eslint-disable-next-line guard-for-in
  for (const i in obj) {
    return false;
  }
  return true;
}

class UpdateMedusaService extends MedusaService({}) {
  productModuleService_: IProductModuleService;
  redisClient_: any;
  regionModuleService_: IRegionModuleService;
  logger: Logger;
  constructor(container: {
    productModuleService: IProductModuleService;
    regionModuleService: IRegionModuleService;
    redisClient: any;
    logger: Logger;
  }) {
    super(container);
    this.redisClient_ = container.redisClient;
    this.productModuleService_ = container.productModuleService;
    this.regionModuleService_ = container.regionModuleService;
    this.logger = container.logger;
  }

  async sendStrapiProductVariantToMedusa(
    variantEntry,
    variantId
  ): Promise<ProductVariant> {
    const ignore = await shouldIgnore_(variantId, "medusa", this.redisClient_);
    if (ignore) {
      return;
    }

    const result = await this.atomicPhase_(async (manager) => {
      const variant = await this.productModuleService_
        .withTransaction(manager)
        .retrieve(variantId);
      const update: Partial<ProductVariant> = {};
      try {
        if (variant.title !== variantEntry.title) {
          update["title"] = variantEntry.title;
        }

        if (!isEmptyObject(update)) {
          const updatedVariant = await this.productVariantService_
            .withTransaction(manager)
            .update(variantId, update)
            .then(async () => {
              return await addIgnore_(variantId, "strapi", this.redisClient_);
            });

          return updatedVariant;
        }
      } catch (error) {
        this.logger.error(error);
        return;
      }
    });
    return result;
  }

  async sendStrapiProductToMedusa(productEntry, productId): Promise<Product> {
    const ignore = await shouldIgnore_(productId, "medusa", this.redisClient_);
    if (ignore) {
      return;
    }

    // get entry from Strapi
    // const productEntry = null

    const result = await this.atomicPhase_(async (manager) => {
      try {
        const product = await this.productService_
          .withTransaction(manager)
          .retrieve(productId);
        if (
          product.handle.toLowerCase().trim() !=
          productEntry.handle.toLowerCase().trim()
        ) {
          this.logger.error(`handle and id mismatch in strapi, `);
          throw new Error(
            "Synchronization Error - handles mismatched, please resync with strapi after dumping strapi database"
          );
        }
        const update = {};
        this.logger.debug("old data in medusa : " + JSON.stringify(product));
        this.logger.debug(
          "data received from strapi : " + JSON.stringify(productEntry)
        );
        const entryKeys = Object.keys(productEntry);
        for (const key of entryKeys) {
          if (
            !(productEntry[key] instanceof Object) &&
            !Array.isArray(productEntry[key])
          ) {
            if (
              product[key] != productEntry[key] &&
              key != "medusa_id" &&
              key != "id"
            )
              update[key] = productEntry[key];
          }
        }

        if (!isEmptyObject(update)) {
          await this.productService_
            .withTransaction(manager)
            .update(productId, update)
            .then(async () => {
              return await addIgnore_(productId, "strapi", this.redisClient_);
            });
        }
        return product;
      } catch (error) {
        this.logger.error(error);
        return;
      }
    });
  }

  async sendStrapiRegionToMedusa(regionEntry, regionId): Promise<Region> {
    const ignore = await shouldIgnore_(regionId, "medusa", this.redisClient_);
    if (ignore) {
      return;
    }
    const result = await this.atomicPhase_(async (manager) => {
      try {
        const region = await this.regionService_
          .withTransaction(manager)
          .retrieve(regionId);
        const update = {};

        if (region.name !== regionEntry.name) {
          update["name"] = regionEntry.name;
        }

        if (!isEmptyObject(update)) {
          const updatedRegion = await this.regionService_
            .withTransaction(manager)
            .update(regionId, update)
            .then(async () => {
              return await addIgnore_(regionId, "strapi", this.redisClient_);
            });
          return updatedRegion;
        }
        return result;
      } catch (error) {
        this.logger.error(error);
        return;
      }
    });
  }
}

export default UpdateMedusaService;
