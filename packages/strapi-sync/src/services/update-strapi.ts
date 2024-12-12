"use strict";

import Redis from "ioredis";
import { AxiosResponse, AxiosError, Method, default as axios } from "axios";
import axiosRetry from "axios-retry";
import qs from "qs";
import passwordGen from "generate-password";
import _ from "lodash";
import {
  StrapiMedusaPluginOptions,
  Tokens,
  StrapiSendParams,
  MedusaUserType,
  AdminUserType,
  AuthInterface,
  CreateInStrapiParams,
  GetFromStrapiParams,
  userCreds as UserCreds,
  StrapiAdminSendParams,
  StrapiResult,
  StrapiGetResult,
  StrapiQueryInterface,
  AdminResult,
  StrapiEntity,
  MedusaGetResult,
} from "@types";
import { UpdateStrapiService } from "@services";
import {
  BaseEntity,
  MedusaError,
  MedusaService,
} from "@medusajs/framework/utils";
import {
  IProductModuleService,
  IRegionModuleService,
  ISalesChannelModuleService,
  Logger,
  ProductCategoryDTO,
  ProductCollectionDTO,
  ProductDTO,
  ProductTypeDTO,
  ProductVariantDTO,
  RegionDTO,
  SalesChannelDTO,
} from "@medusajs/framework/types";
import { sleep } from "@utils";

let strapiRetryDelay: number;

axiosRetry(axios, {
  retries: 100,
  retryDelay: (retryCount, error: any) => {
    error.response &&
      error.response.status === 429 &&
      // Use X-Retry-After rather than Retry-After, and cap retry delay at 60 seconds
      error.response.headers["x-retry-after"] &&
      parseInt(error.response.headers["x-retry-after"]) <= 60;
    let retryHeaderDelay = parseInt(
      error.response.headers["x-retry-after"].toString()
    );
    const rateLimitResetTime = parseInt(
      error.response.headers["x-ratelimit-reset"].toString()
    );

    if (!retryHeaderDelay && !rateLimitResetTime) {
      /** @todo change from fixed back off to exponential backoff */
      // axiosRetry.exponentialDelay(retryCount)*1000
      return 400e3;
    }
    if (!retryHeaderDelay) {
      const currentTime = Date.now();
      const timeDiffms =
        Math.abs(
          parseInt(rateLimitResetTime.toString()) -
            Math.floor(currentTime / 1000)
        ) + 2;
      retryHeaderDelay = timeDiffms * 1000;
      strapiRetryDelay = retryHeaderDelay;
    } else {
      strapiRetryDelay = retryCount * 1000 * retryHeaderDelay;
    }
    console.log(`retrying after ${strapiRetryDelay}`);
    return strapiRetryDelay;
  },
  shouldResetTimeout: false,
  onRetry: (retryCount, error: any) => {
    console.info(
      `retring request ${retryCount}` +
        ` because of ${error.response.status}  ${error.request.path}`
    );
  },
  retryCondition: async (error: any) => {
    return error.response.status === 429;
  },
});

const IGNORE_THRESHOLD = 3; // seconds

export interface UpdateStrapiServiceParams {
  readonly regionModuleService: IRegionModuleService;
  readonly productModuleService: IProductModuleService;
  readonly redisConnection: Redis;
  readonly logger: Logger;
  readonly salesChannelModuleService: ISalesChannelModuleService;
}

export class UpdateMedusaService extends MedusaService({}) {
  static lastHealthCheckTime = 0;
  algorithm: string;
  options_: StrapiMedusaPluginOptions;
  strapi_protocol: string;
  strapi_url: string;
  encryption_key?: string;
  userTokens: Tokens;
  redisClient_: Redis;
  key: WithImplicitCoercion<ArrayBuffer | SharedArrayBuffer>;
  defaultAuthInterface: AuthInterface;
  strapiSuperAdminAuthToken?: string;
  defaultUserEmail: string;
  defaultUserPassword?: string;
  userAdminProfile: { email: string };
  logger: Logger;
  static isHealthy: boolean;
  lastAdminLoginAttemptTime: number;
  static isServiceAccountRegistered: boolean;
  private enableAdminDataLogging: boolean;
  selfTestMode: boolean;
  strapi_port: number;

  constructor(
    container: UpdateStrapiServiceParams,
    options: StrapiMedusaPluginOptions
  ) {
    super(...arguments);

    this.selfTestMode = false;
    this.enableAdminDataLogging = process.env.NODE_ENV == "test" ? true : false;
    this.logger = container.logger ?? (console as any);

    this.options_ = options;
    this.algorithm = this.options_.encryption_algorithm || "aes-256-cbc"; // Using AES encryption
    this.strapi_protocol = this.options_.strapi_protocol ?? "https";
    this.strapi_port =
      this.options_.strapi_port ??
      (this.strapi_protocol == "https" ? undefined : 1337);
    this.strapi_url =
      `${this.strapi_protocol}://` +
      `${this.options_.strapi_host ?? "localhost"}` +
      `${this.strapi_port ? ":" + this.strapi_port : ""}`;
    this.encryption_key =
      this.options_.strapi_secret || this.options_.strapi_public_key;
    UpdateStrapiService.isHealthy = false;
    this.defaultUserEmail = options.strapi_default_user.email;
    this.defaultUserPassword = options.strapi_default_user.password;
    this.defaultAuthInterface = {
      email: this.defaultUserEmail,
      password: this.defaultUserPassword,
    };
    this.userTokens = {};

    this.executeStrapiHealthCheck().then(
      async (res) => {
        if (res && this.options_.auto_start) {
          UpdateStrapiService.isHealthy = res;
          let startupStatus;
          try {
            const startUpResult = await this.startInterface();
            startupStatus = startUpResult.status < 300;
          } catch (error) {
            this.strapiPluginLog("error", error.message);
          }

          if (!startupStatus) throw new Error("strapi startup error");
        }
      },
      () => {
        this.selfTestMode = true;
      }
    );

    // attaching the default user
    this.redisClient_ = new Redis(
      options.redis_url,
      options.redis_options ?? {}
    );
  }

  async startInterface(): Promise<any> {
    try {
      const result = await this.intializeServer();
      this.strapiPluginLog(
        "info",
        "Successfully Bootstrapped the strapi server"
      );
      UpdateStrapiService.isServiceAccountRegistered = true;
      return result;
    } catch (e) {
      this.strapiPluginLog(
        "error",
        `Unable to  bootstrap the strapi server, 
        please check configuration , ${e}`
      );
      throw e;
    }
  }

  async waitForServiceAccountCreation() {
    if (process.env.NODE_ENV != "test")
      while (!UpdateStrapiService.isServiceAccountRegistered) {
        await sleep(3000);
      }
  }

  async addIgnore_(id, side): Promise<any> {
    const key = `${id}_ignore_${side}`;
    return await this.redisClient_.set(
      key,
      1,
      "EX",
      this.options_.strapi_ignore_threshold || IGNORE_THRESHOLD
    );
  }

  async shouldIgnore_(id, side): Promise<any> {
    const key = `${id}_ignore_${side}`;
    return await this.redisClient_.get(key);
  }

  async getVariantEntries_(
    variants,
    authInterface: AuthInterface
  ): Promise<StrapiResult> {
    // eslint-disable-next-line no-useless-catch
    try {
      return { status: 400 };
    } catch (error) {
      throw error;
    }
  }

  async createImageAssets(
    product: ProductDTO,
    authInterface: AuthInterface
  ): Promise<StrapiResult> {
    const assets = await Promise.all(
      product.images
        ?.filter((image) => image.url !== product.thumbnail)
        .map(async (image) => {
          const result = await this.createEntryInStrapi({
            type: "images",
            id: product.id,
            authInterface,
            data: image,
            method: "post",
          });
          return result;
        })
    );
    return assets ? { status: 200, data: assets } : { status: 400 };
  }

  getCustomField(field, type): string {
    const customOptions = this.options_[`custom_${type}_fields`];

    if (customOptions) {
      return customOptions[field] || field;
    } else {
      return field;
    }
  }

  async createEntityInStrapi<T extends Record<string, any>>(
    params: CreateInStrapiParams<T>
  ): Promise<StrapiResult> {
    await this.checkType(params.strapiEntityType, params.authInterface);
    if (!params.entity)
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Something went wrong, not able to retrieve the entity!"
      );

    const result = await this.createEntryInStrapi({
      type: params.strapiEntityType,
      authInterface: params.authInterface,
      data: params.entity,
      method: "POST",
    });
    return result;
  }

  async getEntitiesFromStrapi(
    params: GetFromStrapiParams
  ): Promise<StrapiGetResult> {
    await this.checkType(params.strapiEntityType, params.authInterface);

    const getEntityParams: StrapiSendParams = {
      type: params.strapiEntityType,
      authInterface: params.authInterface,
      method: "GET",
      id: params.id,
      query: params.urlQuery
        ? qs.stringify(params.urlQuery)
        : params.id
        ? undefined
        : qs.stringify({
            fields: ["id", "medusa_id"],
            populate: "*",
          }),
    };
    try {
      const result = await this.getEntriesInStrapi(getEntityParams);
      return {
        data: result?.data,
        status: result.status,
        meta: result?.meta,
      };
    } catch (e) {
      this.strapiPluginLog(
        "error",
        `Unable to retrieve ${params.strapiEntityType}, ${params.id ?? "any"}`,
        getEntityParams
      );
      return { data: undefined, status: 404, meta: undefined };
    }
  }

  async createProductTypeInStrapi(
    entity: ProductTypeDTO,
    authInterface: AuthInterface
  ): Promise<StrapiResult> {
    const params: CreateInStrapiParams<ProductDTO> = {
      entity,
      authInterface: authInterface,
      strapiEntityType: "product-types",
      selectFields: ["id"],
      relations: [],
    };
    return await this.createEntityInStrapi(params);
  }

  async createProductInStrapi(
    product: ProductDTO,
    authInterface: AuthInterface
  ): Promise<StrapiResult> {
    try {
      if (!product)
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          "Something went wrong, not able to retrieve the product!"
        );

      const productToSend: any = _.cloneDeep(product);
      productToSend["product_type"] = _.cloneDeep(productToSend.type);
      delete productToSend.type;
      productToSend["product_tags"] = _.cloneDeep(productToSend.tags);
      delete productToSend.tags;
      productToSend["product_options"] = _.cloneDeep(productToSend.options);
      delete productToSend.options;
      productToSend["product_variants"] = _.cloneDeep(productToSend.variants);
      delete productToSend.variants;

      productToSend["product_collection"] = _.cloneDeep(
        productToSend.collection
      );
      delete productToSend.collection;

      productToSend["product_categories"] = _.cloneDeep(
        productToSend.categories
      );
      delete productToSend.categories;
      this.strapiPluginLog(
        "info",
        `creating product in strapi - ${JSON.stringify(productToSend)}`
      );
      const result = await this.createEntryInStrapi({
        type: "products",
        authInterface,
        data: productToSend,
        method: "POST",
      });
      return result;
    } catch (error) {
      throw error;
    }
  }

  async updateCollectionInStrapi(
    data: Partial<ProductCollectionDTO>,
    authInterface: AuthInterface
  ): Promise<StrapiResult> {
    // const updateFields = ["handle", "title"];
    // TODO:: first check, Update came directly from product collection service so only act on a couple

    // Update came directly from product collection service so only act on a couple
    // of fields. When the update comes from the product we want to ensure
    // references are set up correctly so we run through everything.

    try {
      const ignore = await this.shouldIgnore_(data.id, "strapi");
      if (ignore) {
        return { status: 400 };
      }

      // Update entry in Strapi
      const response = await this.updateEntryInStrapi({
        type: "product-collections",
        id: data.id,
        authInterface,
        data,
        method: "put",
      });
      this.strapiPluginLog(
        "info",
        `Successfully updated collection ${data.id} in Strapi`,
        {
          "response.status": response.status,
          "response.data": response.data,
          "entity.id": data.id,
        }
      );
      return response;
    } catch (error) {
      this.strapiPluginLog("info", "Failed to update product collection", {
        "entity.id": data.id,
        "error.message": error.message,
      });
      return { status: 400 };
    }
  }

  strapiPluginLog(
    logType: string,
    message: string,
    data?: Record<string, any>
  ) {
    if (data && _.isObject(data)) {
      data = _.cloneDeep(data);
      if (data.password) data.password = data.password ? "######" : undefined;
    }
    switch (logType) {
      case "error":
        this.logger.error(
          `${message},data: ${data ? JSON.stringify(data) : ""}`
        );
        break;
      case "warn":
        this.logger.warn(
          `${message},data: ${data ? JSON.stringify(data) : ""}`
        );
        break;
      case "debug":
        this.logger.debug(
          `${message},data: ${data ? JSON.stringify(data) : ""}`
        );
        break;
      default:
        this.logger.info(
          `${message},data: ${data ? JSON.stringify(data) : ""}`
        );
        break;
    }
  }

  async createCollectionInStrapi(
    collection: ProductCollectionDTO,
    authInterface: AuthInterface
  ): Promise<StrapiResult> {
    try {
      if (!collection) throw new Error("Invalid request, no collection found!");
      // this.strapiPluginLog("info",variant)

      const collectionToSend = _.cloneDeep(collection);

      const result = await this.createEntryInStrapi({
        type: "product-collections",
        id: collection.id,
        authInterface,
        data: collectionToSend,
        method: "POST",
      });
      return result;
    } catch (error) {
      this.strapiPluginLog(
        "error",
        `unable to create collection ${collection.id} ${error.message}`
      );
      throw error;
    }
  }

  async updateCategoryInStrapi(
    category: Partial<ProductCategoryDTO>,
    authInterface: AuthInterface
  ): Promise<StrapiResult> {
    // const updateFields = ["handle", "name"];

    // Update came directly from product category service so only act on a couple
    // of fields. When the update comes from the product we want to ensure
    // references are set up correctly so we run through everything.
    // if (data.fields) {
    //   const found =
    //     data.fields.find((f) => updateFields.includes(f)) ||
    //     this.verifyDataContainsFields(data, updateFields);
    //   if (!found) {
    //     return { status: 400 };
    //   }
    // }

    try {
      const ignore = await this.shouldIgnore_(category.id, "strapi");
      if (ignore) return { status: 400 };

      if (!category) return { status: 400 };

      // Update entry in Strapi
      const response = await this.updateEntryInStrapi({
        type: "product-categories",
        id: category.id,
        authInterface,
        data: { ...category },
        method: "put",
      });
      this.strapiPluginLog(
        "info",
        `Successfully updated category ${category.id} in Strapi`,
        {
          "response.status": response.status,
          "response.data": response.data,
          "entity.id": category.id,
        }
      );
      return response;
    } catch (error) {
      this.strapiPluginLog("info", "Failed to update product category", {
        "entity.id": category.id,
        "error.message": error.message,
      });
      return { status: 400 };
    }
  }

  async updateSalesChannelInStrapi(
    sales_channel: SalesChannelDTO,
    authInterface: AuthInterface
  ): Promise<StrapiResult> {
    // const updateFields = ["name"];
    // if (data.fields) {
    //   const found =
    //     data.fields.find((f) => updateFields.includes(f)) ||
    //     this.verifyDataContainsFields(data, updateFields);
    //   if (!found) return { status: 400 };
    // }

    try {
      const ignore = await this.shouldIgnore_(sales_channel.id, "strapi");
      if (ignore) return { status: 400 };

      if (!sales_channel) return { status: 400 };

      // Update entry in Strapi
      let response = await this.updateEntryInStrapi({
        type: "sales-channels",
        id: sales_channel.id,
        authInterface,
        data: { ...sales_channel },
        method: "put",
      });
      if (response.status === 200) return response;
      response = await this.createSalesChannelInStrapi(
        sales_channel,
        authInterface
      );

      this.strapiPluginLog(
        "info",
        `Successfully updated sales channel ${sales_channel.id} in Strapi`,
        {
          "response.status": response.status,
          "response.data": response.data,
          "entity.id": sales_channel.id,
        }
      );
      return response;
    } catch (error) {
      this.strapiPluginLog("info", "Failed to update sales channel", {
        "entity.id": sales_channel.id,
        "error.message": error.message,
      });
      return { status: 400 };
    }
  }

  async createCategoryInStrapi(
    category: ProductCategoryDTO,
    authInterface: AuthInterface
  ): Promise<StrapiResult> {
    try {
      if (!category) throw new Error("Invalid request, category not found!");

      const categoryToSend = _.cloneDeep(category);

      const result = await this.createEntryInStrapi({
        type: "product-categories",
        id: category.id,
        authInterface,
        data: categoryToSend,
        method: "POST",
      });
      return result;
    } catch (error) {
      this.strapiPluginLog(
        "error",
        `unable to create category ${category.id} ${error.message}`
      );
      throw error;
    }
  }

  async createSalesChannelInStrapi(
    salesChannel: SalesChannelDTO,
    authInterface: AuthInterface
  ): Promise<StrapiResult> {
    try {
      if (!salesChannel)
        throw new Error("Invalid request, sales channel not found!");

      const salesChannelToSend = _.cloneDeep(salesChannel);

      const result = await this.createEntryInStrapi({
        type: "sales-channels",
        id: salesChannel.id,
        authInterface,
        data: salesChannelToSend,
        method: "POST",
      });
      return result;
    } catch (error) {
      this.strapiPluginLog(
        "error",
        `unable to create sales channel ${salesChannel.id} ${error.message}`
      );
      throw error;
    }
  }

  async createProductVariantInStrapi(
    variant: ProductVariantDTO,
    authInterface: AuthInterface
  ): Promise<StrapiResult> {
    try {
      if (!variant)
        throw new Error("Invalid request, not able to find variant!");

      const variantToSend: any = _.cloneDeep(variant);
      variantToSend["money_amount"] = _.cloneDeep(variantToSend.prices);
      delete variantToSend.prices;

      variantToSend["product_option_value"] = _.cloneDeep(
        variantToSend.options
      );

      return await this.createEntryInStrapi({
        type: "product-variants",
        id: variant.id,
        authInterface,
        data: variantToSend,
        method: "POST",
      });
    } catch (error) {
      throw error;
    }
  }

  convertOptionValueToMedusaReference(data): Record<string, any> {
    const keys = Object.keys(data);
    for (const key of keys) {
      if (key != "medusa_id" && key.includes("_id")) {
        const medusaService = key.split("_")[0];
        const fieldName = `product_${medusaService}`;
        const value = data[key];

        data[fieldName] = {
          medusa_id: value,
        };
      }
    }
    return data;
  }

  async createRegionInStrapi(
    region: RegionDTO,
    authInterface: AuthInterface
  ): Promise<StrapiResult> {
    try {
      if (!region) throw new Error("Invalid request, not able to find region!");

      return await this.createEntryInStrapi({
        type: "regions",
        id: region.id,
        authInterface,
        data: region,
        method: "post",
      });
    } catch (error) {
      throw error;
    }
  }

  async updateRegionInStrapi(
    region: Partial<RegionDTO>,
    authInterface: AuthInterface = this.defaultAuthInterface
  ): Promise<StrapiResult> {
    if (!region) return { status: 400 };

    const updateFields = [
      "name",
      "currency_code",
      "countries",
      "payment_providers",
      "fulfillment_providers",
    ];

    // check if update contains any fields in Strapi to minimize runs
    const found = this.verifyDataContainsFields(region, updateFields);
    if (!found) return { status: 400 };

    // eslint-disable-next-line no-useless-catch
    try {
      const ignore = await this.shouldIgnore_(region.id, "strapi");
      if (ignore) return { status: 400 };

      // Update entry in Strapi
      const response = await this.updateEntryInStrapi({
        type: "regions",
        id: region.id,
        authInterface,
        data: { ...region },
      });
      this.strapiPluginLog("info", "Region Strapi Id - ", response);
      return response;
    } catch (error) {
      return { status: 400 };
    }
  }
  /**
   * Product metafields id is the same as product id
   * @param data
   * @param authInterface
   * @returns
   */

  async createProductMetafieldInStrapi(
    product: ProductDTO,
    authInterface: AuthInterface = this.defaultAuthInterface
  ): Promise<StrapiResult> {
    const typeExists = await this.checkType(
      "product-metafields",
      authInterface
    );
    if (!typeExists) return { status: 400 };
    if (!product) throw new Error("Invalid request, product not found!");

    const dataToInsert: Partial<ProductDTO> = {
      ..._.cloneDeep(product),
      created_at: product.created_at,
      updated_at: product.updated_at,
    };

    return await this.createEntryInStrapi({
      type: "product-metafields",
      id: product.id,
      authInterface,
      data: dataToInsert,
      method: "post",
    });
  }

  async updateProductMetafieldInStrapi(
    product: Partial<ProductDTO>,
    authInterface: AuthInterface
  ): Promise<StrapiResult> {
    const typeExists = await this.checkType(
      "product-metafields",
      authInterface
    );
    if (!typeExists) return { status: 400 };

    if (!product) throw new Error("Invalid request, product not found!");

    const dataToUpdate: Partial<ProductDTO> & { medusa_id?: string } = {
      ..._.cloneDeep(product),
      created_at: product.created_at,
      updated_at: product.updated_at,
      medusa_id: product.id?.toString(),
    };
    delete dataToUpdate.id;
    return await this.updateEntryInStrapi({
      type: "product-metafields",
      id: product.id,
      authInterface,
      data: { ...product, ...dataToUpdate },
      method: "put",
    });
  }

  async updateProductsWithinCollectionInStrapi(
    products: Partial<ProductDTO>[],
    authInterface: AuthInterface = this.defaultAuthInterface
  ): Promise<StrapiResult> {
    try {
      for (const product of products) {
        const ignore = await this.shouldIgnore_(product.id, "strapi");
        if (ignore) {
          this.strapiPluginLog(
            "info",
            "Strapi has just added this product to collection which triggered this function. IGNORING... "
          );
          continue;
        }
        if (!product) continue;

        // we're sending requests sequentially as the Strapi is having problems with deadlocks otherwise
        await this.adjustProductAndUpdateInStrapi(product, authInterface);
      }

      return { status: 200 };
    } catch (error) {
      this.strapiPluginLog(
        "error",
        "Error updating products in collection",
        error
      );
      throw error;
    }
  }

  async updateProductsWithinCategoryInStrapi(
    products: Partial<ProductDTO>[],
    authInterface: AuthInterface = this.defaultAuthInterface
  ): Promise<StrapiResult> {
    try {
      for (const product of products) {
        const ignore = await this.shouldIgnore_(product.id, "strapi");
        if (ignore) {
          this.strapiPluginLog(
            "info",
            "Strapi has just added this product to category which triggered this function. IGNORING... "
          );
          continue;
        }

        if (!product) continue;
        // we're sending requests sequentially as the Strapi is having problems with deadlocks otherwise
        await this.adjustProductAndUpdateInStrapi(product, authInterface);
      }
      return { status: 200 };
    } catch (error) {
      this.strapiPluginLog(
        "error",
        "Error updating products in category",
        error
      );
      throw error;
    }
  }

  async updateProductInStrapi(
    product: Partial<ProductDTO>,
    authInterface: AuthInterface = this.defaultAuthInterface
  ): Promise<StrapiResult> {
    // const updateFields = [
    //   "variants",
    //   "options",
    //   "tags",
    //   "title",
    //   "subtitle",
    //   "tags",
    //   "type",
    //   "type_id",
    //   "collection",
    //   "collection_id",
    //   "categories",
    //   "thumbnail",
    //   "height",
    //   "weight",
    //   "width",
    //   "length",
    // ];

    // // check if update contains any fields in Strapi to minimize runs
    // const found = this.verifyDataContainsFields(data, updateFields);
    // if (!found) return { status: 400 };

    // eslint-disable-next-line no-useless-catch
    try {
      const ignore = await this.shouldIgnore_(product.id, "strapi");
      if (ignore) {
        this.strapiPluginLog(
          "info",
          "Strapi has just updated this product" +
            " which triggered this function. IGNORING... "
        );
        return { status: 400 };
      }

      if (!product) {
        console.log(
          "update failed as product doesn't exist, creating product instead"
        );
        return await this.createProductInStrapi(product, authInterface);
      }

      const updateRes = await this.adjustProductAndUpdateInStrapi(
        product,
        authInterface
      );
      if (updateRes.status == 200) return updateRes;

      const updateAfterCreateRes = await this.adjustProductAndUpdateInStrapi(
        product,
        authInterface
      );
      return updateAfterCreateRes;
    } catch (error) {
      throw error;
    }
  }

  private async adjustProductAndUpdateInStrapi(
    product: Partial<ProductDTO>,
    authInterface: AuthInterface
  ) {
    // Medusa is not using consistent naming for product-*.
    // We have to adjust it manually. For example: collection to product-collection
    const dataToUpdate = { ...product };

    const keysToUpdate = [
      "collection",
      "categories",
      "type",
      "tags",
      "variants",
      "options",
    ];
    for (const key of keysToUpdate) {
      if (key in dataToUpdate) {
        dataToUpdate[`product_${key}`] = dataToUpdate[key];
        delete dataToUpdate[key];
      }
    }

    const response = await this.updateEntryInStrapi({
      type: "products",
      id: product.id,
      authInterface,
      data: dataToUpdate,
      method: "put",
    });
    return response;
  }

  async checkType(type, authInterface): Promise<boolean> {
    let result: StrapiResult;
    try {
      result = await this.getType(type, authInterface);
    } catch (error) {
      this.strapiPluginLog("error", `${type} type not found in strapi`);
      return false;
    }
    return result ? true : false;
  }

  async updateProductVariantInStrapi(
    variant: Partial<ProductVariantDTO>,
    authInterface: AuthInterface
  ): Promise<StrapiResult> {
    // const updateFields = [
    //   "title",
    //   "prices",
    //   "sku",
    //   "material",
    //   "weight",
    //   "length",
    //   "height",
    //   "origin_country",
    //   "options",
    // ];
    let response = { status: 400 };
    // Update came directly from product variant service so only act on a couple
    // of fields. When the update comes from the product we want to ensure
    // references are set up correctly so we run through everything.
    // if (data.fields) {
    //   const found =
    //     data.fields.find((f) => updateFields.includes(f)) ||
    //     this.verifyDataContainsFields(data, updateFields);
    //   if (!found) return { status: 400 };
    // }

    const ignore = await this.shouldIgnore_(variant.id, "strapi");
    if (ignore) return { status: 400 };

    this.strapiPluginLog("info", JSON.stringify(variant));
    if (!variant) throw new Error("Invalid request, variant not found!");

    try {
      // Update entry in Strapi

      response = await this.updateEntryInStrapi({
        type: "product-variants",
        id: variant.id,
        authInterface,
        data: { ...variant },
        method: "put",
      });
      this.strapiPluginLog("info", "Variant Strapi Id - ", response);
      return response;
    } catch (e) {
      this.strapiPluginLog("info", "Created Variant Strapi Id - ", response);
      return response;
    }
  }

  async deleteProductMetafieldInStrapi(
    data: { id: string },
    authInterface: AuthInterface
  ): Promise<StrapiResult> {
    const ignore = await this.shouldIgnore_(data.id, "strapi");
    if (ignore) {
      return { status: 400 };
    }

    return await this.deleteEntryInStrapi({
      type: "product-metafields",
      id: data.id,
      authInterface,
      method: "delete",
    });
  }

  async deleteProductInStrapi(
    data,
    authInterface: AuthInterface
  ): Promise<StrapiResult> {
    const ignore = await this.shouldIgnore_(data.id, "strapi");
    if (ignore) return { status: 400 };

    return await this.deleteEntryInStrapi({
      type: "products",
      id: data.id,
      authInterface,
      method: "delete",
    });
  }

  async deleteProductTypeInStrapi(
    data,
    authInterface: AuthInterface
  ): Promise<StrapiResult> {
    const ignore = await this.shouldIgnore_(data.id, "strapi");
    if (ignore) return { status: 400 };

    return await this.deleteEntryInStrapi({
      type: "product-types",
      id: data.id,
      authInterface,
      method: "delete",
    });
  }

  async deleteProductVariantInStrapi(
    data,
    authInterface: AuthInterface
  ): Promise<StrapiResult> {
    const ignore = await this.shouldIgnore_(data.id, "strapi");
    if (ignore) return { status: 400 };

    return await this.deleteEntryInStrapi({
      type: "product-variants",
      id: data.id,
      authInterface,
      method: "delete",
    });
  }

  // Blocker - Delete Region API
  async deleteRegionInStrapi(data, authInterface): Promise<StrapiResult> {
    const ignore = await this.shouldIgnore_(data.id, "strapi");
    if (ignore) return { status: 400 };

    return await this.deleteEntryInStrapi({
      type: "regions",
      id: data.id,
      authInterface,
      method: "delete",
    });
  }

  // Blocker - Create Sales Channel API
  async deleteSalesChannelInStrapi(data, authInterface): Promise<StrapiResult> {
    const ignore = await this.shouldIgnore_(data.id, "strapi");
    if (ignore) return { status: 400 };

    return await this.deleteEntryInStrapi({
      type: "sales-channels",
      id: data.id,
      authInterface,
      method: "delete",
    });
  }

  async deleteCollectionInStrapi(data, authInterface): Promise<StrapiResult> {
    const ignore = await this.shouldIgnore_(data.id, "strapi");
    if (ignore) return { status: 400 };

    return await this.deleteEntryInStrapi({
      type: "product-collections",
      id: data.id,
      authInterface,
      method: "delete",
    });
  }
  async deleteCategoryInStrapi(data, authInterface): Promise<StrapiResult> {
    const ignore = await this.shouldIgnore_(data.id, "strapi");
    if (ignore) return { status: 400 };

    return await this.deleteEntryInStrapi({
      type: "product-categories",
      id: data.id,
      authInterface,
      method: "delete",
    });
  }

  async getType(
    type: string,
    authInterface: AuthInterface
  ): Promise<StrapiResult> {
    const result = await this.strapiSendDataLayer({
      method: "get",
      type,
      authInterface,
    });

    return result;
  }

  private async executeStrapiHealthCheck(): Promise<boolean> {
    const config = {
      url: `${this.strapi_url}/_health`,
    };
    this.strapiPluginLog("info", `Checking Strapi Health `);
    if (process.env.NODE_ENV == "test" && this.selfTestMode) {
      this.strapiPluginLog("info", "running in self test mode");
      return true;
    }

    this.strapiPluginLog("debug", `check-url: ${config.url} `);

    try {
      let response: Awaited<ReturnType<typeof axios.head>> = undefined;
      let timeOut = this.options_.strapi_healthcheck_timeout ?? 120e3;
      while (timeOut-- > 0) {
        try {
          response = await axios.head(config.url);
        } catch (e) {
          this.strapiPluginLog("error", `health check error ${e.message}`);
        }
        if (response && response?.["status"]) break;

        this.strapiPluginLog(
          "error",
          `response from the server: ${response?.["status"] ?? "no-response"}`
        );
        await sleep(3000);
      }
      UpdateStrapiService.lastHealthCheckTime = Date.now();
      if (!response) {
        UpdateStrapiService.isHealthy = false;
        return UpdateMedusaService.isHealthy;
      }

      UpdateStrapiService.isHealthy = response?.["status"] < 300 ? true : false;
      if (UpdateStrapiService.isHealthy)
        this.strapiPluginLog("info", "Strapi is healthy");
      else this.strapiPluginLog("info", "Strapi is unhealthy");

      return UpdateStrapiService.isHealthy;
    } catch (error) {
      this.strapiPluginLog("error", "Strapi health check failed");
      UpdateStrapiService.isHealthy = false;
      return false;
    }
  }

  async checkStrapiHealth(): Promise<boolean> {
    const currentTime = Date.now();

    const timeInterval = this.options_.strapi_healthcheck_timeout ?? 120e3;
    const timeDifference =
      currentTime - (UpdateStrapiService.lastHealthCheckTime ?? 0);
    const intervalElapsed = timeDifference > timeInterval;

    if (!UpdateStrapiService.isHealthy) {
      /** clearing tokens if the health check fails dirty */
      this.userTokens = Object.assign(this.userTokens, {});
      this.strapiSuperAdminAuthToken = undefined;
    }

    if (process.env.NODE_ENV == "test" && this.selfTestMode) return true;

    const result =
      intervalElapsed || !UpdateStrapiService.isHealthy
        ? await this.executeStrapiHealthCheck()
        : UpdateStrapiService.isHealthy; /** sending last known health status */

    return result;
  }
  /**
   *
   * @param text the text to encrpyt
   * @returns encrypted text
   */
  encrypt(text: string): string {
    return text;
  }
  /**
   * @todo  implement decryption
   * @param text
   * @returns
   */

  // Decrypting text
  decrypt(text): string {
    return text;
  }
  /**
   *
   * @returns the default user  - service account for medusa requests
   */
  async registerDefaultMedusaUser(): Promise<{ id: string }> {
    try {
      const authParams = {
        ...this.options_.strapi_default_user,
      };
      const registerResponse = await this.executeRegisterMedusaUser(authParams);
      UpdateStrapiService.isServiceAccountRegistered = true;
      return registerResponse?.data;
    } catch (error) {
      this.strapiPluginLog("error", "unable to register default user", {
        error: (error as Error).message,
      });
      throw error;
    }
  }
  /**
   * Deletes the service account
   * @returns the deleted default user
   */

  async deleteDefaultMedusaUser(): Promise<StrapiResult> {
    try {
      const response = await this.deleteMedusaUserFromStrapi(
        this.defaultAuthInterface
      );

      delete this.userTokens[this.defaultAuthInterface.email as string];
      return response;
    } catch (error) {
      this.strapiPluginLog(
        "error",
        "unable to delete default user: " + (error as Error).message
      );
      throw error;
    }
  }

  /**
   * Deletes a medusa user from strapi
   * @param authInterface - the user authorisation parameters
   * @returns
   */

  async deleteMedusaUserFromStrapi(
    authInterface: AuthInterface
  ): Promise<StrapiResult> {
    const fetchedUser = await this.strapiSendDataLayer({
      method: "get",
      type: "users",
      id: "me",
      data: undefined,
      authInterface,
    });

    this.strapiPluginLog("info", "found user: " + JSON.stringify(fetchedUser));

    const result = await this.executeStrapiSend({
      method: "delete",
      type: "users",
      token: this.userTokens[authInterface.email as string].token,
      id: fetchedUser.id?.toString(),
    });
    return { data: result.data.data ?? result.data, status: result.status };
  }

  /**
	 * @Todo Create API based access
  async fetchMedusaUserApiKey(emailAddress) {

	return await this.strapiAdminSend("get")
  }

  */

  async executeSync(token: string): Promise<AxiosResponse> {
    await this.waitForHealth();
    try {
      const result = await axios.post(
        `${this.strapi_url}/strapi-plugin-medusajs/synchronise-medusa-tables`,
        {},
        {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 3600e3 /** temp workaround to stop retransmissions over 900ms*/,
        }
      );
      this.strapiPluginLog(
        "info",
        "successfully initiated two way syncs trapi<-->medusa"
      );
      return result;
    } catch (error) {
      this._axiosError(
        error,
        undefined,
        undefined,
        undefined,
        undefined,
        `${this.strapi_url}/strapi-plugin-medusajs/synchronise-medusa-tables`
      );
      throw error;
    }
  }

  /**
   * Readies the server to be used with a service account
   */

  async configureStrapiMedusaForUser(
    authInterface: AuthInterface
  ): Promise<StrapiResult> {
    const { email } = authInterface;
    try {
      const jwt = (await this.strapiLoginSendDatalayer(authInterface)).token;
      if (!jwt) {
        this.strapiPluginLog("error", "no jwt for this user: " + email);
        return { status: 400 };
      }
      const result = await this.executeSync(jwt);
      return { status: result.status };
    } catch (error) {
      // Handle error.
      this.strapiPluginLog("info", "Unable to sync An error occurred:", error);
      return { status: 400 };
    }
  }

  async retrieveRefreshedToken(
    authInterface: AuthInterface,
    errorCode?: string | number
  ) {
    const { email } = authInterface;
    if (!email)
      throw new Error("Invalid request, email not found in authInterface!");

    const currentTime = Date.now();
    const lastRetrived = this.userTokens[email.toLowerCase()];
    if (lastRetrived && errorCode != "401") {
      if (!strapiRetryDelay) strapiRetryDelay = 180e3;

      const diff =
        Math.floor(currentTime / 1000) -
        Math.floor((lastRetrived.time ?? 0) / 1000);
      if (diff < strapiRetryDelay) {
        this.strapiPluginLog("debug", "using cached user credentials ");
        return lastRetrived;
      }
    }
    try {
      const res = await this.executeLoginAsStrapiUser(authInterface);
      if (!res.data?.jwt)
        throw new Error("Invalid request, jwt token not found!");

      this.userTokens[email.toLowerCase()] = {
        token: res.data.jwt /** caching the jwt token */,
        time: Date.now(),
        user: res.data.user,
      };
      this.strapiPluginLog(
        "info",
        `${email} ` + "successfully logged in to Strapi"
      );
      return this.userTokens[email.toLowerCase()];
    } catch (error) {
      this.strapiPluginLog(
        "error",
        `${email} ` + "error logging in in to Strapi"
      );
      this._axiosError(error);
      throw error;
    }
  }

  async strapiLoginSendDatalayer(
    authInterface: AuthInterface = {
      email: this.defaultUserEmail,
      password: this.defaultUserPassword,
    }
  ): Promise<UserCreds> {
    const creds = await this.retrieveRefreshedToken(authInterface);
    if (!creds)
      throw new Error(
        "Invalid request, something went wrong while refreshing the token!"
      );

    return creds;
  }

  async executeLoginAsStrapiUser(
    authInterface: AuthInterface = {
      email: this.defaultUserEmail,
      password: this.defaultUserPassword,
    }
  ): Promise<AxiosResponse> {
    await this.waitForHealth();
    await this.waitForServiceAccountCreation();
    try {
      const authData = {
        identifier: authInterface.email?.toLowerCase(),
        password: authInterface.password,
      };
      this.strapiPluginLog("info", `firing: ${this.strapi_url}/api/auth/local`);
      const response = await axios.post(
        `${this.strapi_url}/api/auth/local`,
        authData
      );

      return response;
    } catch (error) {
      this._axiosError(
        error,
        undefined,
        undefined,
        undefined,
        undefined,
        `${this.strapi_url}/api/auth/local`
      );
      throw new Error(
        `\n Error  ${authInterface.email} while trying to login to strapi\n` +
          (error as Error).message
      );
    }
  }
  async getRoleId(requestedRole: string): Promise<number> {
    const response = await this.executeStrapiAdminSend("get", "roles");
    let idToReturn = -1;
    // console.log("role:", response);
    if (response) {
      const availableRoles = response.data.data;
      const theRole = availableRoles?.filter(
        (role) => role.name == requestedRole
      );

      idToReturn = theRole?.[0]?.id ?? -1;
    }
    return idToReturn;
  }
  async processStrapiEntry(command: StrapiSendParams): Promise<StrapiResult> {
    try {
      const result = await this.strapiSendDataLayer(command);
      return result;
    } catch (e) {
      this.strapiPluginLog(
        "error",
        "Unable to process strapi entry request: " + e.message
      );
      return { status: 400, data: undefined };
    }
  }

  async doesEntryExistInStrapi(
    type: string,
    id: string,

    authInterface: AuthInterface
  ): Promise<StrapiResult> {
    return await this.processStrapiEntry({
      method: "get",
      type,
      id,
      authInterface,
    });
  }

  async createEntryInStrapi(command: StrapiSendParams): Promise<StrapiResult> {
    let result: StrapiGetResult;
    try {
      if (command.id) {
        /** to check if the request field already exists */
        result = await this.getEntriesInStrapi({
          type: command.type,
          method: "get",
          id: command.data.id,
          data: undefined,
          authInterface: command.authInterface,
        });

        if (result?.data?.length > 0 && result.status == 200)
          return {
            status: result.status == 200 ? 302 : 400,
            data: result.data[0],
          };
      }
    } catch (e) {
      this.strapiPluginLog("info", e.message);
    }

    const createResponse = await this.processStrapiEntry({
      ...command,
      method: "post",
    });

    return createResponse;
  }
  async getEntriesInStrapi(
    command: StrapiSendParams
  ): Promise<StrapiGetResult> {
    const result = await this.processStrapiEntry({
      ...command,
      method: "get",
    });
    return {
      data: _.isArray(result.data) ? [...result.data] : [result.data],
      meta: result?.meta,
      status: result.status,
    };
  }

  async updateEntryInStrapi(command: StrapiSendParams): Promise<StrapiResult> {
    try {
      const putResult = await this.processStrapiEntry({
        ...command,
        method: "put",
        id: command.data.id,
        query: undefined,
      });
      return putResult;
    } catch (err) {
      this.strapiPluginLog(
        "error",
        `entity doesn't exist in strapi :${err.message} : ${command.id} , update not possible!`
      );
      throw err;
    }
  }

  async deleteEntryInStrapi(command: StrapiSendParams): Promise<StrapiResult> {
    return await this.processStrapiEntry({
      ...command,
      method: "delete",
    });
  }

  private isEntity(data: any): boolean {
    return data instanceof Object && ("id" in data || "medusa_id" in data);
  }

  // Medusa is using underscores to represent relations between entities, strapi is using dashes.
  // This library is translating it in some places but omitting others, this method is providing automatic translation
  // on every sent request.
  private translateRelationNamesToStrapiFormat(
    dataToSend: StrapiEntity,
    key: string
  ): StrapiEntity {
    let testObject = null;

    if (_.isArray(dataToSend[key])) {
      if (dataToSend[key].length > 0) {
        testObject = dataToSend[key][0];
      }
    } else {
      testObject = dataToSend[key];
    }

    // if the object is a not empty array or object without id or medusa_id, it's not relation
    if (testObject && !this.isEntity(testObject)) {
      return dataToSend;
    }

    if (key.includes("-")) {
      dataToSend[key.replace("-", "_")] = dataToSend[key];
      delete dataToSend[key];
    }

    return dataToSend;
  }
  private translateRelationNamesToMedusaFormat(
    dataReceived: StrapiGetResult,
    key: string
  ): StrapiGetResult {
    let testObject = null;

    if (_.isArray(dataReceived[key]) && dataReceived[key].length > 0)
      testObject = dataReceived[key][0];
    else testObject = dataReceived[key];

    // if the object is a not empty array or object without id or medusa_id, it's not relation
    if (testObject && !this.isEntity(testObject)) return dataReceived;

    if (key.includes("_") && key != "meudsa_id") {
      dataReceived[key.replace("_", "-")] = dataReceived[key];
      delete dataReceived[key];
    }

    return dataReceived;
  }

  translateDataToStrapiFormat(dataToSend: StrapiEntity): StrapiEntity {
    const keys = Object.keys(dataToSend);
    const keysToIgnore = ["id", "created_at", "updated_at", "deleted_at"];

    for (const key of keys) {
      if (_.isArray(dataToSend[key])) {
        for (const element of dataToSend[key]) {
          this.isEntity(element) && this.translateDataToStrapiFormat(element);
        }
        this.translateRelationNamesToStrapiFormat(dataToSend, key);
      }

      if (dataToSend[key] instanceof Object && this.isEntity(dataToSend[key])) {
        this.translateDataToStrapiFormat(dataToSend[key]);
        this.translateRelationNamesToStrapiFormat(dataToSend, key);
      } else if (key == "id") {
        dataToSend["medusa_id"] = dataToSend[key];
      }

      if (this.isEntity(dataToSend) && keysToIgnore.includes(key)) {
        delete dataToSend[key];
      }
    }
    return dataToSend as BaseEntity & { medusa_id?: string };
  }

  translateDataToMedusaFormat(
    dataReceived: StrapiGetResult
  ): MedusaGetResult<typeof dataReceived.data> {
    const keys = Object.keys(dataReceived);
    const keysToIgnore = ["id", "created_at", "updated_at", "deleted_at"];

    for (const key of keys) {
      if (_.isArray(dataReceived[key])) {
        for (const element of dataReceived[key]) {
          this.isEntity(element) && this.translateDataToStrapiFormat(element);
        }
        this.translateRelationNamesToMedusaFormat(dataReceived, key);
      }

      if (
        dataReceived[key] instanceof Object &&
        this.isEntity(dataReceived[key])
      ) {
        this.translateDataToStrapiFormat(dataReceived[key]);
        this.translateRelationNamesToMedusaFormat(dataReceived, key);
      } else if (key == "medusa_id") {
        dataReceived["id"] = dataReceived[key];
      }

      if (this.isEntity(dataReceived) && keysToIgnore.includes(key)) {
        delete dataReceived[key];
      }
    }
    return dataReceived as MedusaGetResult<typeof dataReceived.data>;
  }

  /* using cached tokens */
  /* @todo enable api based access */
  /* automatically converts "id" into medusa "id"*/
  async strapiSendDataLayer(params: StrapiSendParams): Promise<StrapiResult> {
    const { method, type, id, data, authInterface, query } = params;

    const userCreds = await this.strapiLoginSendDatalayer(authInterface);
    if (!userCreds) {
      this.strapiPluginLog("error", `no such user:${authInterface.email}`);
      return { status: 400 };
    }
    let dataToSend: StrapiEntity;
    if (data && data.id) {
      dataToSend = _.cloneDeep(data);
      dataToSend = this.translateDataToStrapiFormat(dataToSend);
    } else dataToSend = data;

    try {
      const result = await this.executeStrapiSend({
        method,
        type,
        token: userCreds.token,
        id,
        data: dataToSend,
        query,
      });
      return {
        id: result.data.id ?? result.data.data?.id,
        medusa_id: result.data.medusa_id ?? result.data.data?.medusa_id,
        status: result.status,
        data: result.data.data ?? result.data,
        query,
      };
    } catch (e) {
      if (e instanceof AxiosError) {
        await this.retrieveRefreshedToken(authInterface, "401");
        return await this.strapiSendDataLayer(params);
      }

      if (e instanceof AxiosError) {
        if (method?.toLowerCase() == "get" && e.response?.status == 404) {
          this.strapiPluginLog(
            "error",
            `unable to find ${type} id: ${id} query:${query} message: ${e.message}`,
            params
          );
          return {
            status: e.response.status,
            query,
          };
        } else {
          this._axiosError(e, id, type, data, method);
          throw e;
        }
      }

      this.strapiPluginLog("error", e.message);
      return { status: 400 };
    }
  }
  /**
   * Blocks the process until strapi is healthy
   *
   *
   */

  async waitForHealth(): Promise<void> {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const health = await this.checkStrapiHealth();
      if (health) {
        break;
      }
      this.strapiPluginLog("debug", "Awaiting Strapi Health");

      await sleep(1000);
    }
  }

  async executeStrapiSend({
    method,
    type,
    token,
    id,
    data,
    query,
  }: {
    method: Method | undefined;
    type: string;
    token: string;
    id?: string;
    data?: any;
    query?: string;
  }): Promise<AxiosResponse> {
    let endPoint: string;
    await this.waitForHealth();
    await this.waitForServiceAccountCreation();
    let tail = "";
    //	if (method.toLowerCase() != 'post') {
    if (!method || method.toLowerCase() != "post") {
      if (
        id &&
        id != "" &&
        id.trim().toLocaleLowerCase() != "me" &&
        type.toLowerCase() != "users" &&
        (!method || method.toLowerCase() == "get") &&
        query
      )
        tail = `?${this.appendIdToStrapiFilter(query, id)}`;
      else tail = id ? `/${id}` : "";

      if (tail == "" && query) tail = `?${query}`;
    }
    endPoint = `${this.strapi_url}/api/${type}${tail}`;

    this.strapiPluginLog("info", `User endpoint: ${endPoint}`);
    const basicConfig = {
      method: method,
      url: endPoint,
      headers: { Authorization: `Bearer ${token}` },
    };
    this.strapiPluginLog("info", `${basicConfig.method} ${basicConfig.url}`);
    const config = data ? { ...basicConfig, data } : { ...basicConfig };

    try {
      this.strapiPluginLog(
        "debug",
        `User Endpoint firing: ${endPoint} method: ${method} query:${query}`
      );
      const result = await axios(config);
      this.strapiPluginLog(
        "debug",
        `User Endpoint fired: ${endPoint} method : ${method} query:${query}`
      );
      // console.log("attempting action:"+result);
      if (result.status >= 200 && result.status < 300) {
        this.strapiPluginLog(
          "debug",
          `Strapi Ok : method: ${method}, id:${id}, type:${type},` +
            ` data:${JSON.stringify(data)}, :status:${
              result.status
            } query:${query}`
        );
      }

      return result;
    } catch (error) {
      this._axiosError(error, id, type, data, method, endPoint);
      throw error;
    }
  }
  appendIdToStrapiFilter(query: string, id?: string): string {
    const urlQuery = qs.parse(query) as any;
    const idFromUrlParams = urlQuery?.filters?.id;
    const medusaIdFromUrlParams = urlQuery?.fitlers?.medusa_id;
    if ((idFromUrlParams || medusaIdFromUrlParams) && id) {
      throw new Error("Multiple Ids in the Request");
    }
    id = id ?? medusaIdFromUrlParams ?? idFromUrlParams;
    const originalFilters = urlQuery.filters;
    const newFilters = id
      ? {
          ...originalFilters,
          medusa_id: id,
        }
      : undefined;
    urlQuery.filters = newFilters;
    return qs.stringify(urlQuery);
  }

  _axiosError(
    error: AxiosError,
    id?: string,
    type?: string,
    data?: any,
    method?: Method,
    endPoint?: string
  ): void {
    if (endPoint)
      this.strapiPluginLog("info", `Endpoint Attempted: ${endPoint}`);

    if (error?.response?.status === 200) return;

    if (error?.response?.status === 401) throw error;

    this.handleError(error, id, type, data, method, endPoint);
  }

  handleError(
    error: any,
    id?: string,
    type?: string,
    data?: any,
    method?: Method,
    endPoint?: string
  ) {
    const theError = `${(error as Error).message} `;
    const responseData = _.isEmpty(data) ? {} : error?.response?.data ?? "none";
    if (data) data.password = data?.password ? "#" : undefined;
    this.strapiPluginLog(
      "error",
      "Error occur while sending request to strapi:  " +
        JSON.stringify({
          "error.message": theError,
          request: {
            url: endPoint || "none",
            data: JSON.stringify(data) || "none",
            method: method || "none",
          },
          response: {
            body: JSON.stringify(responseData),
            status: error?.response?.status ?? "none",
          },
        })
    );

    if (!endPoint?.includes("register-admin")) {
      this.strapiPluginLog(
        "error",
        `Error while trying ${method}` +
          `,${type ?? ""} -  ${id ? `id: ${id}` : ""}  ,
                }  entry in strapi ${theError}`
      );
      throw error;
    }
  }
  async executeStrapiAdminSend(
    method: Method | undefined,
    type: string,
    id?: string,
    action?: string,
    data?: any,
    query?: string
  ): Promise<AxiosResponse | undefined> {
    const result = await this.executeLoginAsStrapiSuperAdmin();
    if (!result) {
      this.strapiPluginLog(
        "error",
        "No user Bearer token, check axios request"
      );
      return;
    }

    let headers: axios.AxiosRequestConfig["headers"] = undefined;
    /** refreshed token */
    this.strapiSuperAdminAuthToken = result.data.token;
    if (this.strapiSuperAdminAuthToken) {
      headers = {
        Authorization: `Bearer ${this.strapiSuperAdminAuthToken}`,
        "Content-type": "application/json",
      };
    }
    const path = [type, action, id].filter((itm) => !!itm);
    const q = query ? `?${query}` : "";
    const finalUrl = `${this.strapi_url}/admin/${path.join("/")}${q}`;
    const basicConfig: axios.AxiosRequestConfig = {
      method: method,
      url: finalUrl,
      headers,
    };
    this.strapiPluginLog("info", `Admin Endpoint fired: ${basicConfig.url}`);
    const config = data ? { ...basicConfig, data } : { ...basicConfig };
    try {
      const result = await axios(config);
      if (!(result.status >= 200 && result.status < 300)) {
        this.strapiPluginLog("info", "Admin endpoint error recieved", result);
        return result;
      }

      if (this.enableAdminDataLogging && data?.password)
        data.password = "#####";

      this.strapiPluginLog(
        "debug",
        `Strapi Ok : ${method}, ${id ?? ""}` +
          `, ${type ?? ""}, ${this.enableAdminDataLogging ? data ?? "" : ""}, ${
            action ?? ""
          } :status:${result.status}`
      );
      this.strapiPluginLog(
        "info",
        `Strapi Data : ${JSON.stringify(result.data)}`
      );

      return result;
    } catch (error) {
      //  this.strapiPluginLog("error",'Admin endpoint error');
      if (this.enableAdminDataLogging && data?.password)
        data.password = "#####";

      this._axiosError(
        error,
        id,
        type,
        this.enableAdminDataLogging ? data : {},
        method,
        basicConfig.url
      );
      throw error;
    }
  }

  async executeRegisterMedusaUser(
    auth: MedusaUserType
  ): Promise<AxiosResponse | undefined> {
    try {
      await this.executeLoginAsStrapiSuperAdmin();
      if (!this.selfTestMode) await this.waitForHealth();
    } catch (e) {
      if (this.selfTestMode)
        this.strapiPluginLog("warn", "running in self testmode");
      throw e;
    }

    try {
      const response = await axios.post(
        `${this.strapi_url}/strapi-plugin-medusajs/create-medusa-user`,
        auth,
        {
          headers: {
            Authorization: `Bearer ${this.strapiSuperAdminAuthToken}`,
          },
          timeout: 3600e3 /** temp workaround to stop retransmissions over 900ms*/,
        }
      );

      return response;
    } catch (e) {
      this.strapiPluginLog("error", "user registration error");
      this._axiosError(e);
      throw e;
    }
  }
  /** *
   * send the command using elevated privileges
   */

  async strapiAdminSendDatalayer(
    command: StrapiAdminSendParams
  ): Promise<AdminResult> {
    const { method, type, id, action, data, query } = command;
    try {
      const result = await this.executeStrapiAdminSend(
        method,
        type,
        id,
        action,
        data,
        query
      );
      return { data: result?.data, status: result?.status ?? 400 };
    } catch (e) {
      this.strapiPluginLog("error", e.message);
      return { data: undefined, status: 400 };
    }
  }

  async registerSuperAdminUserInStrapi(): Promise<any> {
    const auth: AdminUserType = {
      ...this.options_.strapi_admin,
    };
    try {
      const result = await this.executeStrapiAdminSend(
        "post",
        "register-admin",
        undefined,
        undefined,
        auth
      );
      if (!result)
        throw new Error("Invalid request, strapi admin send request failed!");

      return result.data?.user;
    } catch (err) {
      this.strapiPluginLog(
        "warn",
        `unable to register super user, super user may already registered, ${err.message}`
      );
      throw err;
    }
  }

  async updateAdminUserInStrapi(
    email: string,
    firstname: string,
    password = passwordGen.generate({
      length: 16,
      numbers: true,
      strict: true,
    }),
    role = "Author",
    isActive = true
  ): Promise<AdminResult> {
    const userData = await this.getAdminUserInStrapi(email.toLowerCase());
    if (userData) {
      const roleId = await this.getRoleId(role);
      const auth = {
        email: email.toLowerCase(),
        firstname,
        password,
        isActive,
        roles: [roleId],
      };

      return await this.strapiAdminSendDatalayer({
        method: "put",
        type: "users",
        id: userData.data.id,
        // action: "user",
        data: auth,
      });
    } else {
      return { data: undefined, status: 400 };
    }
  }

  async getAdminUserInStrapi(email: string): Promise<AdminResult> {
    const userData = await this.strapiAdminSendDatalayer({
      method: "get",
      type: "users",
      id: undefined,
      action: undefined,
      query: this.createStrapiRestQuery({
        fields: ["email"],
        filters: {
          email: `${email}`.toLocaleLowerCase(),
        },
      }),
    });
    if (userData.status == 200) {
      return { status: 200, data: userData.data.data.results[0] };
    } else {
      return { status: 400, data: undefined };
    }
  }

  async getAllAdminUserInStrapi(): Promise<AdminResult> {
    return await this.strapiAdminSendDatalayer({
      method: "get",
      type: "users",
      id: undefined,
      action: undefined,
    });
  }
  async deleteAdminUserInStrapi(
    email: string,
    role = "Author"
  ): Promise<AdminResult> {
    const user = await this.getAdminUserInStrapi(email);

    return await this.strapiAdminSendDatalayer({
      method: "delete",
      type: "users",
      id: user.data.id,
    });
  }

  fetchUserToken(email: string = this.defaultUserEmail): string {
    const token = this.userTokens[email].token;
    if (token) {
      this.strapiPluginLog("info", "fetched token for: " + email);
    }
    return token;
  }
  async executeLoginAsStrapiSuperAdmin(): Promise<{
    data: { user: any; token?: string };
  }> {
    const auth = {
      email: this.options_.strapi_admin.email,
      password: this.options_.strapi_admin.password,
    };
    const currentLoginAttempt = Date.now();
    const timeDiff = Math.floor(
      (currentLoginAttempt - (this.lastAdminLoginAttemptTime ?? 0)) / 1000
    );
    if (
      strapiRetryDelay &&
      timeDiff < strapiRetryDelay &&
      this.strapiSuperAdminAuthToken
    ) {
      return {
        data: {
          user: this.userAdminProfile,
          token: this.strapiSuperAdminAuthToken,
        },
      };
    }
    this.lastAdminLoginAttemptTime = currentLoginAttempt;
    await this.waitForHealth();
    const adminUrl = `${this.strapi_url}/admin/login`;
    try {
      const response = await axios.post(adminUrl, auth, {
        headers: {
          "Content-Type": "application/json",
        },
      });

      this.strapiPluginLog(
        "info",
        "Logged In   Admin " + auth.email + " with strapi"
      );
      this.strapiPluginLog("info", "Admin profile", response.data.data.user);

      this.strapiSuperAdminAuthToken = response.data.data.token;
      this.userAdminProfile = response.data.data.user;
      return {
        data: {
          user: this.userAdminProfile,
          token: this.strapiSuperAdminAuthToken,
        },
      };
    } catch (error) {
      // Handle error.
      this.strapiPluginLog(
        "info",
        "An error occurred" + " while logging into admin:"
      );
      this._axiosError(
        error,
        undefined,
        undefined,
        undefined,
        undefined,
        `${this.strapi_url}/admin/login`
      );

      throw error;
    }
  }
  async intializeServer(): Promise<any> {
    await this.registerOrLoginAdmin();
    if (!this.strapiSuperAdminAuthToken) {
      this.strapiPluginLog("error", "unable to connect as super user");
      return;
    }

    const user = (await this.registerOrLoginDefaultMedusaUser()).user;
    if (!this.options_.sync_on_init) return { status: 200 };

    if (!user) {
      this.strapiPluginLog("error", "unable to login default user");
      return;
    }

    const response = await this.executeSync(this.strapiSuperAdminAuthToken);
    if (response.status < 300) {
      this.strapiPluginLog(
        "info",
        "medusa - strap -bootstrap confirmed ..please wait till sync completes"
      );
      return response;
    }
  }
  async registerOrLoginAdmin(): Promise<{
    data: { user: any; token?: string };
  }> {
    try {
      await this.registerSuperAdminUserInStrapi();
    } catch (e) {
      this.strapiPluginLog("info", "super admin already registered", e);
    }
    return await this.executeLoginAsStrapiSuperAdmin();
  }

  async loginAsDefaultMedusaUser(): Promise<UserCreds> {
    try {
      const userCrds = await this.strapiLoginSendDatalayer(
        this.defaultAuthInterface
      );

      this.strapiPluginLog("info", "Default Medusa User Logged In");
      return userCrds;
    } catch (error) {
      this.strapiPluginLog(
        "error",
        "Unable to login default medusa user: " + (error as Error).message
      );
      throw error;
    }
  }

  async registerOrLoginDefaultMedusaUser(): Promise<UserCreds> {
    try {
      await this.registerDefaultMedusaUser();
      this.strapiPluginLog("info", "registered default user");
    } catch (e) {
      this.strapiPluginLog("info", "default user already registered", e);
    }
    return await this.loginAsDefaultMedusaUser();
  }
  verifyDataContainsFields(data: any, updateFields: any[]): boolean {
    if (!data || _.isEmpty(data)) return false;
    let found = data.fields?.find((f) => updateFields.includes(f));
    if (!found) {
      try {
        const fieldsOfdata = Object.keys(data);
        found = fieldsOfdata.some((field) => {
          return updateFields.some((uf) => {
            return uf == field;
          });
        });
      } catch (e) {
        this.strapiPluginLog("error", JSON.stringify(e));
      }
    }
    return found;
  }
  /**
   * This function allows you to create a strapi query
   */
  createStrapiRestQuery(strapiQuery: StrapiQueryInterface): string {
    const {
      sort,
      filters,
      populate,
      fields,
      pagination,
      publicationState,
      locale,
    } = strapiQuery;

    const query = qs.stringify(
      {
        sort,
        filters,
        populate,
        fields,
        pagination,
        publicationState,
        locale,
      },
      { encodeValuesOnly: true }
    );
    return query;
  }
}
export default UpdateMedusaService;
