import { createElement } from "react";
import type { HTMLAttributes, JSX, ReactNode } from "react";
import { CONTENT_ATTR, EXCLUDE_ATTR } from "../shared/conventions";

type MarkerProps = { as?: keyof JSX.IntrinsicElements; children?: ReactNode } & HTMLAttributes<HTMLElement>;

function marker(attr: string, props: MarkerProps): JSX.Element {
  const { as = "div", children, ...rest } = props;
  return createElement(as, { ...rest, [attr]: "" }, children);
}

export function ContentRegion(props: MarkerProps): JSX.Element {
  return marker(CONTENT_ATTR, props);
}

export function ExcludeFromContent(props: MarkerProps): JSX.Element {
  return marker(EXCLUDE_ATTR, props);
}
