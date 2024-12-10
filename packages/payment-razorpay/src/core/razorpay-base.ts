import { EOL } from "os";

import Razorpay from "razorpay";
import crypto from "crypto";
import { Orders } from "razorpay/dist/types/orders";
import { Refunds } from "razorpay/dist/types/refunds";
import { Payments } from "razorpay/dist/types/payments";

import {
  CreatePaymentProviderSession,
  Logger,
  PaymentProviderError,
  PaymentProviderSessionResponse,
  ProviderWebhookPayload,
  UpdatePaymentProviderSession,
  WebhookActionResult,
} from "@medusajs/framework/types";
import {
  AbstractPaymentProvider,
  isDefined,
  isPaymentProviderError,
  MedusaError,
  PaymentActions,
  PaymentSessionStatus,
} from "@medusajs/framework/utils";
import { ErrorCodes, PaymentIntentOptions, RazorpayOptions } from "../types";
import {
  getAmountFromSmallestUnit,
  getSmallestUnit,
} from "../utils/get-smallest-unit";

type InjectedDependencies = {
  logger: Logger;
};

abstract class RazorpayBase extends AbstractPaymentProvider<RazorpayOptions> {
  protected readonly options_: RazorpayOptions;
  protected razorpay_: Razorpay;
  readonly logger: Logger;

  static validateOptions(options: RazorpayOptions): void {
    if (!isDefined(options.key_id) || !isDefined(options.key_secret)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Required option `key_id/key_secret` is missing in Razorpay plugin"
      );
    }
  }

  protected constructor(
    container: InjectedDependencies,
    options: RazorpayOptions
  ) {
    // @ts-ignore
    super(...arguments);

    this.options_ = options;
    this.logger = container.logger as Logger;

    this.init();
  }

  abstract get paymentIntentOptions(): PaymentIntentOptions;

  get options(): RazorpayOptions {
    return this.options_;
  }

  protected init(): void {
    this.razorpay_ =
      this.razorpay_ ||
      new Razorpay({
        key_id: this.options_.key_id,
        key_secret: this.options_.key_secret,
        headers: {
          "Content-Type": "application/json",
          "X-Razorpay-Account": this.options_.razorpay_account ?? undefined,
        },
      });
  }

  getPaymentIntentOptions(): PaymentIntentOptions {
    const options: PaymentIntentOptions = {};

    if (this?.paymentIntentOptions?.capture_method) {
      options.capture_method = this.paymentIntentOptions.capture_method;
    }

    if (this?.paymentIntentOptions?.setup_future_usage) {
      options.setup_future_usage = this.paymentIntentOptions.setup_future_usage;
    }

    if (this?.paymentIntentOptions?.payment_method_types) {
      options.payment_method_types =
        this.paymentIntentOptions.payment_method_types;
    }

    return options;
  }

  async getRazorpayPaymentStatus(
    paymentIntent: Orders.RazorpayOrder
  ): Promise<PaymentSessionStatus> {
    if (!paymentIntent) {
      return PaymentSessionStatus.ERROR;
    }
    return PaymentSessionStatus.AUTHORIZED;
  }

  async getPaymentStatus(
    paymentSessionData: Record<string, unknown>
  ): Promise<PaymentSessionStatus> {
    const id = paymentSessionData.id as string;
    const orderId = paymentSessionData.order_id as string;
    let paymentIntent: Orders.RazorpayOrder;
    try {
      paymentIntent = await this.razorpay_.orders.fetch(id);
    } catch (e) {
      this.logger.warn("received payment data from session not order data");
      paymentIntent = await this.razorpay_.orders.fetch(orderId);
    }

    switch (paymentIntent.status) {
      // created' | 'authorized' | 'captured' | 'refunded' | 'failed'
      case "created":
        return PaymentSessionStatus.REQUIRES_MORE;

      case "paid":
        return PaymentSessionStatus.AUTHORIZED;

      case "attempted":
        return await this.getRazorpayPaymentStatus(paymentIntent);

      default:
        return PaymentSessionStatus.PENDING;
    }
  }

  _validateSignature(
    razorpay_payment_id: string,
    razorpay_order_id: string,
    razorpay_signature: string
  ): boolean {
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac("sha256", this.options_.key_secret as string)
      .update(body.toString())
      .digest("hex");
    return expectedSignature === razorpay_signature;
  }

  async initiatePayment(
    input: CreatePaymentProviderSession
  ): Promise<PaymentProviderError | PaymentProviderSessionResponse> {
    const intentRequestData = this.getPaymentIntentOptions();
    const { session_id } = input.context;
    const { currency_code, amount } = input;

    const intentRequest: Orders.RazorpayOrderCreateRequestBody & {
      payment_capture?: Orders.RazorpayCapturePayment;
    } = {
      amount: getSmallestUnit(amount, currency_code),
      currency: currency_code.toUpperCase(),
      notes: { session_id: session_id ?? "" },
      payment: {
        capture: this.options_.auto_capture ? "automatic" : "manual",
        capture_options: {
          refund_speed: this.options_.refund_speed ?? "normal",
          automatic_expiry_period: Math.max(
            this.options_.automatic_expiry_period ?? 20,
            12
          ),
          manual_expiry_period: Math.max(
            this.options_.manual_expiry_period ?? 10,
            7200
          ),
        },
      },
      ...intentRequestData,
    };

    let session_data: Orders.RazorpayOrder | undefined;
    try {
      try {
        this.logger.debug(`the intent: ${JSON.stringify(intentRequest)}`);
        session_data = await this.razorpay_.orders.create(intentRequest);
      } catch (e) {
        return this.buildError(
          "An error occurred in InitiatePayment during the creation of the razorpay payment intent: " +
            JSON.stringify(e),
          e
        );
      }
    } catch (e) {
      return this.buildError(
        "An error occurred in creating customer request:" + e.message,
        e
      );
    }

    return { data: { ...(session_data ?? {}) } };
  }

  async authorizePayment(
    paymentSessionData: Record<string, unknown>,
    context: Record<string, unknown>
  ): Promise<
    | PaymentProviderError
    | {
        status: PaymentSessionStatus;
        data: PaymentProviderSessionResponse["data"];
      }
  > {
    const status = await this.getPaymentStatus(paymentSessionData);
    return { data: paymentSessionData, status };
  }

  async cancelPayment(
    paymentSessionData: Record<string, unknown>
  ): Promise<PaymentProviderError | PaymentProviderSessionResponse["data"]> {
    const error: PaymentProviderError = {
      error: "Unable to cancel as razorpay doesn't support cancellation",
      code: ErrorCodes.UNSUPPORTED_OPERATION,
    };

    return error;
  }

  async capturePayment(
    paymentSessionData: Record<string, unknown>
  ): Promise<PaymentProviderError | PaymentProviderSessionResponse["data"]> {
    const order_id = (paymentSessionData as unknown as Orders.RazorpayOrder).id;
    const paymentsResponse = await this.razorpay_.orders.fetchPayments(
      order_id
    );
    const possibleCaptures = paymentsResponse.items?.filter(
      (item) => item.status == "authorized"
    );
    const result = possibleCaptures?.map(async (payment) => {
      const { id, amount, currency } = payment;

      const paymentIntent = await this.razorpay_.payments.capture(
        id,
        amount as string,
        currency as string
      );
      return paymentIntent;
    });
    if (result) {
      const payments = await Promise.all(result);
      const res = payments.reduce(
        (acc, curr) => ((acc[curr.id] = curr), acc),
        {}
      );
      (paymentSessionData as unknown as Orders.RazorpayOrder).payments = res;
    }
    return paymentSessionData;
  }

  async deletePayment(
    paymentSessionData: Record<string, unknown>
  ): Promise<PaymentProviderError | PaymentProviderSessionResponse["data"]> {
    return await this.cancelPayment(paymentSessionData);
  }

  async refundPayment(
    paymentSessionData: Record<string, unknown>,
    refundAmount: number
  ): Promise<PaymentProviderError | PaymentProviderSessionResponse["data"]> {
    try {
      const id = (paymentSessionData as unknown as Orders.RazorpayOrder)
        .id as string;
      const payments = await this.razorpay_.orders.fetchPayments(id);
      const payment_id = payments.items.find((p) => {
        return parseInt(`${p.amount}`.toString()) >= refundAmount;
      })?.id;
      if (payment_id) {
        const refundRequest: Refunds.RazorpayRefundCreateRequestBody = {
          amount: refundAmount,
        };
        try {
          const refundSession = await this.razorpay_.payments.refund(
            payment_id,
            refundRequest
          );
          const refundsIssued =
            paymentSessionData.refundSessions as Refunds.RazorpayRefund[];
          if (refundsIssued?.length > 0) {
            refundsIssued.push(refundSession);
          } else {
            paymentSessionData.refundSessions = [refundSession];
          }
        } catch (e) {
          return this.buildError("An error occurred in refundPayment", e);
        }
      }
      return paymentSessionData;
    } catch (error) {
      return this.buildError("An error occurred in refundPayment", error);
    }
  }

  async retrievePayment(
    paymentSessionData: Record<string, unknown>
  ): Promise<PaymentProviderError | PaymentProviderSessionResponse["data"]> {
    let intent;
    try {
      const id = (paymentSessionData as unknown as Orders.RazorpayOrder)
        .id as string;
      intent = await this.razorpay_.orders.fetch(id);
    } catch (e) {
      const id = (paymentSessionData as unknown as Payments.RazorpayPayment)
        .order_id as string;
      try {
        intent = await this.razorpay_.orders.fetch(id);
      } catch (e) {
        this.buildError("An error occurred in retrievePayment", e);
      }
    }
    return intent as unknown as PaymentProviderSessionResponse["data"];
  }

  async updatePayment(
    input: UpdatePaymentProviderSession
  ): Promise<PaymentProviderError | PaymentProviderSessionResponse> {
    const result = await this.initiatePayment(input);
    if (isPaymentProviderError(result)) {
      return this.buildError(
        "An error occurred in updatePayment during the initiate of the new payment for the new customer",
        result
      );
    }

    return result;
  }

  async updatePaymentData(
    sessionId: string,
    data: Record<string, unknown>
  ): Promise<PaymentProviderSessionResponse["data"] | PaymentProviderError> {
    try {
      // Prevent from updating the amount from here as it should go through
      // the updatePayment method to perform the correct logic
      if (data.amount || data.currency) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Cannot update amount, use updatePayment instead"
        );
      }
      try {
        const paymentSession = await this.razorpay_.payments.fetch(
          (data.data as Record<string, any>).id as string
        );
        if (data.notes || (data.data as any)?.notes) {
          const notes = data.notes || (data.data as any)?.notes;
          const result = (await this.razorpay_.orders.edit(sessionId, {
            notes: { ...paymentSession.notes, ...notes },
          })) as unknown as PaymentProviderSessionResponse["data"];
          return result;
        } else {
          this.logger.warn("only notes can be updated in razorpay order");
          return paymentSession as unknown as PaymentProviderSessionResponse["data"];
        }
      } catch (e) {
        return (data as Record<string, any>).data ?? data;
      }
    } catch (e) {
      return this.buildError("An error occurred in updatePaymentData", e);
    }
  }

  async getWebhookActionAndData(
    webhookData: ProviderWebhookPayload["payload"]
  ): Promise<WebhookActionResult> {
    const authorized = this.constructWebhookEvent(webhookData);
    if (!authorized) return { action: PaymentActions.FAILED };

    const data = webhookData.data as any;

    const { currency } = data;
    switch (data.event) {
      case "payment.captured":
        return {
          action: PaymentActions.AUTHORIZED,
          data: {
            session_id: data.notes.session_id,
            amount: getAmountFromSmallestUnit(data.amount_capturable, currency), // NOTE: revisit when implementing multicapture
          },
        };
      case "payment.succeeded":
        return {
          action: PaymentActions.SUCCESSFUL,
          data: {
            session_id: data.notes.session_id,
            amount: getAmountFromSmallestUnit(data.amount_received, currency),
          },
        };
      case "payment.failed":
        return {
          action: PaymentActions.FAILED,
          data: {
            session_id: data.notes.session_id,
            amount: getAmountFromSmallestUnit(data.amount, currency),
          },
        };
      default:
        return { action: PaymentActions.NOT_SUPPORTED };
    }
  }

  /**
   * Constructs Razorpay Webhook event
   * @param {object} data - the data of the webhook request: req.body
   *    ensures integrity of the webhook event
   * @return {object} Razorpay Webhook event
   */
  constructWebhookEvent(data: ProviderWebhookPayload["payload"]): boolean {
    const signature = data.headers["x-razorpay-signature"] as string;

    return Razorpay.validateWebhookSignature(
      data.rawData as string,
      signature,
      this.options_.webhook_secret
    );
  }
  protected buildError(
    message: string,
    error: PaymentProviderError | Error
  ): PaymentProviderError {
    return {
      error: message,
      code: "code" in error ? error.code : "unknown",
      detail: isPaymentProviderError(error)
        ? `${error.error}${EOL}${error.detail ?? ""}`
        : "detail" in error
        ? error.detail
        : error.message ?? "",
    };
  }
}

export default RazorpayBase;
