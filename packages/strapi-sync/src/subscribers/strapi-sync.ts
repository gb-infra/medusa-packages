import {
  IEventBusModuleService,
  IProductModuleService,
  Logger,
} from "@medusajs/framework/types";
import { UpdateStrapiService } from "@services";
import { AuthInterface } from "@types";

class StrapiSubscriber {
  readonly productModuleService_: IProductModuleService;
  readonly updateStrapiService_: UpdateStrapiService;
  readonly eventBusModuleService_: IEventBusModuleService;
  protected loggedInUserAuth: AuthInterface;
  readonly logger: Logger;

  constructor({
    updateStrapiService,
    productModuleService,
    eventBusModuleService,
    logger,
  }) {
    this.productModuleService_ = productModuleService;
    this.updateStrapiService_ = updateStrapiService;
    this.eventBusModuleService_ = eventBusModuleService;
    this.logger = logger;
    this.logger.info("Strapi Subscriber Initialized");

    this.eventBusModuleService_.subscribe(
      "region.created",
      async ({ data, name, metadata }) => {
        const authInterace: AuthInterface =
          (await this.getLoggedInUserStrapiCreds()) ??
          this.updateStrapiService_.defaultAuthInterface;
        await this.updateStrapiService_.createRegionInStrapi(
          (data as any).id,
          authInterace
        );
      }
    );

    this.eventBusModuleService_.subscribe(
      "region.updated",
      async ({ data }) => {
        const authInterace: AuthInterface =
          (await this.getLoggedInUserStrapiCreds()) ??
          this.updateStrapiService_.defaultAuthInterface;
        await this.updateStrapiService_.updateRegionInStrapi(
          (data as any).id,
          authInterace
        );
      }
    );

    this.eventBusModuleService_.subscribe(
      "product-variant.created",
      async ({ data }) => {
        const authInterace: AuthInterface =
          (await this.getLoggedInUserStrapiCreds()) ??
          this.updateStrapiService_.defaultAuthInterface;
        await this.updateStrapiService_.createProductVariantInStrapi(
          (data as any).id,
          authInterace
        );
      }
    );

    this.eventBusModuleService_.subscribe(
      "product-variant.updated",
      async ({ data }) => {
        const authInterace: AuthInterface =
          (await this.getLoggedInUserStrapiCreds()) ??
          this.updateStrapiService_.defaultAuthInterface;
        await this.updateStrapiService_.updateProductVariantInStrapi(
          data,
          authInterace
        );
      }
    );

    this.eventBusModuleService_.subscribe(
      "product.updated",
      async ({ data }) => {
        const authInterace: AuthInterface =
          (await this.getLoggedInUserStrapiCreds()) ??
          this.updateStrapiService_.defaultAuthInterface;
        await this.updateStrapiService_.updateProductInStrapi(data);
        if ((data as any).variants?.length > 0) {
          const result = (data as any).variants.map(
            async (value, index, array) => {
              await this.updateStrapiService_.updateProductVariantInStrapi(
                value,
                authInterace
              );
            }
          );
          await Promise.all(result);
        }
      }
    );

    this.eventBusModuleService_.subscribe(
      "product.created",
      async ({ data }) => {
        const authInterace: AuthInterface =
          (await this.getLoggedInUserStrapiCreds()) ??
          this.updateStrapiService_.defaultAuthInterface;
        await this.updateStrapiService_.createProductInStrapi(
          (data as any).id,
          authInterace
        );
        if ((data as any).variants?.length > 0) {
          const result = (data as any).variants.map(
            async (value, index, array) => {
              await this.updateStrapiService_.createProductVariantInStrapi(
                value.id,
                authInterace
              );
            }
          );
          await Promise.all(result);
        }
      }
    );

    this.eventBusModuleService_.subscribe(
      "product.metafields.create",
      async ({ data }) => {
        const authInterace: AuthInterface =
          (await this.getLoggedInUserStrapiCreds()) ??
          this.updateStrapiService_.defaultAuthInterface;
        await this.updateStrapiService_.createProductMetafieldInStrapi(
          data as any,
          authInterace
        );
      }
    );

    this.eventBusModuleService_.subscribe(
      "product.metafields.update",
      async ({ data }) => {
        const authInterace: AuthInterface =
          (await this.getLoggedInUserStrapiCreds()) ??
          this.updateStrapiService_.defaultAuthInterface;
        await this.updateStrapiService_.updateProductMetafieldInStrapi(
          data as any,
          authInterace
        );
      }
    );

    this.eventBusModuleService_.subscribe(
      "product-collection.updated",
      async ({ data }) => {
        const authInterace: AuthInterface =
          (await this.getLoggedInUserStrapiCreds()) ??
          this.updateStrapiService_.defaultAuthInterface;
        await this.updateStrapiService_.updateCollectionInStrapi(
          data,
          authInterace
        );
      }
    );

    this.eventBusModuleService_.subscribe(
      "product-collection.created",
      async ({ data }) => {
        const authInterace: AuthInterface =
          (await this.getLoggedInUserStrapiCreds()) ??
          this.updateStrapiService_.defaultAuthInterface;
        await this.updateStrapiService_.createCollectionInStrapi(
          (data as any).id,
          authInterace
        );
      }
    );

    this.eventBusModuleService_.subscribe(
      "product-collection.product-added",
      async ({ data }) => {
        const authInterace: AuthInterface =
          (await this.getLoggedInUserStrapiCreds()) ??
          this.updateStrapiService_.defaultAuthInterface;
        await this.updateStrapiService_.updateProductsWithinCollectionInStrapi(
          (data as any).id,
          authInterace
        );
      }
    );

    this.eventBusModuleService_.subscribe(
      "product-collection.product-removed",
      async ({ data }) => {
        const authInterace: AuthInterface =
          (await this.getLoggedInUserStrapiCreds()) ??
          this.updateStrapiService_.defaultAuthInterface;
        await this.updateStrapiService_.updateProductsWithinCollectionInStrapi(
          (data as any).id,
          authInterace
        );
      }
    );

    this.eventBusModuleService_.subscribe(
      "product-category.updated",
      async ({ data }) => {
        const authInterace: AuthInterface =
          (await this.getLoggedInUserStrapiCreds()) ??
          this.updateStrapiService_.defaultAuthInterface;
        await this.updateStrapiService_.updateCategoryInStrapi(
          data,
          authInterace
        );
      }
    );

    this.eventBusModuleService_.subscribe(
      "product-category.created",
      async ({ data }) => {
        const authInterace: AuthInterface =
          (await this.getLoggedInUserStrapiCreds()) ??
          this.updateStrapiService_.defaultAuthInterface;
        await this.updateStrapiService_.createCategoryInStrapi(
          (data as any).id,
          authInterace
        );
      }
    );

    this.eventBusModuleService_.subscribe(
      "product.deleted",
      async ({ data }) => {
        const authInterace: AuthInterface =
          (await this.getLoggedInUserStrapiCreds()) ??
          this.updateStrapiService_.defaultAuthInterface;
        await this.updateStrapiService_.deleteProductInStrapi(
          data,
          authInterace
        );
      }
    );

    this.eventBusModuleService_.subscribe(
      "product-variant.deleted",
      async ({ data }) => {
        const authInterace: AuthInterface =
          (await this.getLoggedInUserStrapiCreds()) ??
          this.updateStrapiService_.defaultAuthInterface;
        await this.updateStrapiService_.deleteProductVariantInStrapi(
          data,
          authInterace
        );
      }
    );

    // Blocker - Delete Region API
    this.eventBusModuleService_.subscribe(
      "region.deleted",
      async ({ data }) => {
        const authInterace: AuthInterface =
          (await this.getLoggedInUserStrapiCreds()) ??
          this.updateStrapiService_.defaultAuthInterface;
        await this.updateStrapiService_.deleteRegionInStrapi(
          data,
          authInterace
        );
      }
    );

    this.eventBusModuleService_.subscribe(
      "sales-channel.created",
      async ({ data }) => {
        const authInterace: AuthInterface =
          (await this.getLoggedInUserStrapiCreds()) ??
          this.updateStrapiService_.defaultAuthInterface;
        await this.updateStrapiService_.createSalesChannelInStrapi(
          (data as any).id,
          authInterace
        );
      }
    );

    this.eventBusModuleService_.subscribe(
      "sales-channel.updated",
      async ({ data }) => {
        const authInterace: AuthInterface =
          (await this.getLoggedInUserStrapiCreds()) ??
          this.updateStrapiService_.defaultAuthInterface;
        await this.updateStrapiService_.updateSalesChannelInStrapi(
          data,
          authInterace
        );
      }
    );

    this.eventBusModuleService_.subscribe(
      "sales-channel.deleted",
      async ({ data }) => {
        const authInterace: AuthInterface =
          (await this.getLoggedInUserStrapiCreds()) ??
          this.updateStrapiService_.defaultAuthInterface;
        await this.updateStrapiService_.deleteSalesChannelInStrapi(
          data,
          authInterace
        );
      }
    );
  }

  async getLoggedInUserStrapiCreds(): Promise<AuthInterface> {
    return this.loggedInUserAuth;
  }

  setLoggedInUserCreds(email, password): void {
    this.loggedInUserAuth = {
      email,
      password,
    };
  }
}

export default StrapiSubscriber;
