import { Seo } from "../../../../../src/index";

export function Hidden() {
  return (
    <>
      <Seo title="Hidden" description="Only reachable via routes" />
      <main>
        <h1>Hidden</h1>
      </main>
    </>
  );
}
