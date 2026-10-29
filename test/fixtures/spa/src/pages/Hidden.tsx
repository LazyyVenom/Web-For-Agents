import { Seo } from "../../../../../src/index";

export function Hidden() {
  return (
    <>
      <Seo
        title="Hidden"
        description="Only reachable via routes"
        lang="ar"
        locale="ar_EG"
        alternateLocales={["en_US"]}
        alternates={[
          { hrefLang: "ar", href: "/hidden" },
          { hrefLang: "en", href: "/about" },
          { hrefLang: "x-default", href: "/about" },
        ]}
      />
      <main>
        <h1>Hidden</h1>
      </main>
    </>
  );
}
