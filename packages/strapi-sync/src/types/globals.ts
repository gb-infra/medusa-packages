import { AxiosError, Method } from "axios";
import { BaseEntity } from "@medusajs/framework/utils";
import { IModuleService } from "@medusajs/framework/types";

export interface StrapiMedusaPluginOptions {
  sync_on_init?: boolean;
  enable_auto_retry?: boolean;
  encryption_algorithm: string;
  strapi_protocol: string;
  strapi_host: string;
  strapi_default_user: MedusaUserType;
  strapi_admin: AdminUserType;
  strapi_port: number;
  strapi_secret?: string;
  strapi_public_key?: string;
  strapi_ignore_threshold: number;
  enable_marketplace?: boolean;
  strapi_healthcheck_timeout?: number;
  auto_start?: boolean;
  max_page_size?: number;
}

export type userCreds = {
  token: string;
  time: number;
  user: { id: string; email: string };
};
export type Tokens = {
  [key: string]: userCreds;
};

export interface StrapiSignalInterface {
  message: string;
  code: number;
  data: any;
}

export interface AuthInterface {
  email?: string;
  password?: string;
  apiKey?: string /** todo implementation  */;
}

export type AdminUserType = {
  email: string;
  username?: string;
  password: string;
  firstname: string;
  name?: string;
  lastname?: string;
};
export type MedusaUserType = {
  username?: string;
  password?: string;
  email: string;
  firstname: string;
  confirmed: boolean;
  blocked: boolean;
  provider?: string;
};
export interface StrapiSendParams {
  method?: Method;
  type: string;
  authInterface: AuthInterface;
  data?: any;
  id?: string;
  action?: string;
  username?: string;
  query?: string;
}

export interface StrapiAdminSendParams {
  method?: Method;
  type: string;
  data?: any;
  id?: string;
  action?: string;
  username?: string;
  query?: string;
}

export interface CreateInStrapiParams<
  T extends Record<string, any>,
  K extends IModuleService
> {
  id: string;
  authInterface: AuthInterface;
  strapiEntityType: string;
  serviceMethod: keyof K;
  medusaService: K;
  selectFields: (keyof T)[];
  relations: string[];
}

export interface GetFromStrapiParams {
  id?: string;
  authInterface: AuthInterface;
  strapiEntityType: string;
  urlParams?: Record<string, string>;
  urlQuery?: Record<string, unknown>;
}

export type StrapiEntity = Omit<BaseEntity, "id"> & {
  id?: string;
  medusa_id?: string;
};
export type AdminResult = { data: any; status: number };
export type AdminGetResult = {
  data: {
    data: {
      results: [];
    };
    meta: any;
  };
  status: number;
};

export type MedusaGetResult<T> = {
  data: T;
  meta?: any;

  status: number;
  medusa_id?: string;
  id?: number;
};

export type StrapiResult = {
  medusa_id?: string;
  id?: number;
  data?: any | any[];
  meta?: Record<string, any>;
  status: number;
  query?: string;
};

export type StrapiGetResult =
  | StrapiResult
  | {
      data: any[];
      meta?: any;

      status: number;
      medusa_id?: string;
      id?: number | string;
    };

export interface StrapiQueryInterface {
  fields: string[];
  filters: Record<string, unknown>;
  populate?: any;
  sort?: string[];
  pagination?: {
    pageSize: number;
    page: number;
  };
  publicationState?: string;
  locale?: string[];
}

export interface LoginTokenExpiredErrorParams
  extends Partial<StrapiSendParams> {
  response?: { status: number };
  message?: string;
  error?: AxiosError;
  time?: Date;
}

export type StrapiSeedType =
  | Record<string, StrapiEntity[]>
  | Record<string, StrapiEntity>
  | StrapiEntity;

export interface StrapiSeedInterface {
  meta: {
    pageNumber: number;
    pageLimit: number;
    hasMore: Record<string, boolean>;
  };
  data: StrapiSeedType;
}

export interface UpdateMedusaDataInterface {
  type: string;
  data: any;
  origin: "strapi" | "medusa";
}
