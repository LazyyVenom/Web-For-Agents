// React-free entry: `@anubhav-choubey/web-for-agents/schema`. Must not import react, react-dom or the agent runtime.
export { schema, serializeJsonLd } from "../runtime/schema";
export type { JsonLdNode, JsonLdGraph, JsonLdRef, JsonLdNodeOptions, JsonLdExtra, JsonLdEmbeddable } from "../runtime/schema";
export type {
  ItemAvailability,
  ItemCondition,
  OfferInput,
  AggregateOfferInput,
  OffersInput,
  RatingInput,
  AggregateRatingInput,
  ReviewInput,
  ReviewsInput,
  StandaloneOptions,
  AuthorInput,
  BreadcrumbItem,
  PageOptions,
  RecipeInput,
  NutritionInput,
} from "../runtime/schema";
