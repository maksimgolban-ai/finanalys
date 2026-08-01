(() => {
  const pageMap = {
    "dashboard.html": { id: "dashboard", title: "Финансовый дашборд" },
    "money.html": { id: "money", title: "Деньги" },
    "capital.html": { id: "capital", title: "Капитал" },
    "profit.html": { id: "profit", title: "Прибыль" },
    "": { id: "dashboard", title: "Финансовый дашборд" },
    "index.html": { id: "dashboard", title: "Финансовый дашборд" }
  };

  const shell = document.querySelector("[data-shell]");
  const navLinks = Array.from(document.querySelectorAll("[data-nav-link]"));
  const topbarTitle = document.querySelector("[data-page-title]");
  const sidebarToggle = document.querySelector("[data-sidebar-toggle]");
  const overlay = document.querySelector("[data-overlay]");
  const sourceField = document.querySelector("[data-source-field]");
  const sourceLink = document.querySelector("[data-source-link]");
  const core = window.GSCore || null;

  const currentFile = window.location.pathname.split("/").pop().toLowerCase();
  const currentPage = pageMap[currentFile] || pageMap["dashboard.html"];

  if (topbarTitle) {
    topbarTitle.textContent = currentPage.title;
  }

  navLinks.forEach((link) => {
    const isActive = link.getAttribute("data-page") === currentPage.id;
    link.classList.toggle("is-active", isActive);
    link.setAttribute("aria-current", isActive ? "page" : "false");
  });

  const closeSidebar = () => {
    if (!shell) {
      return;
    }

    shell.classList.remove("is-nav-open");
    document.body.style.overflow = "";
  };

  const openSidebar = () => {
    if (!shell) {
      return;
    }

    shell.classList.add("is-nav-open");
    document.body.style.overflow = "hidden";
  };

  if (sidebarToggle) {
    sidebarToggle.addEventListener("click", () => {
      if (shell && shell.classList.contains("is-nav-open")) {
        closeSidebar();
      } else {
        openSidebar();
      }
    });
  }

  if (overlay) {
    overlay.addEventListener("click", closeSidebar);
  }

  navLinks.forEach((link) => {
    link.addEventListener("click", () => {
      if (window.innerWidth <= 1024) {
        closeSidebar();
      }
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeSidebar();
    }
  });

  if (sourceField && sourceLink) {
    if (core && typeof core.getDataSourceUrl === "function") {
      const resolvedSourceUrl = core.getDataSourceUrl();
      if (resolvedSourceUrl) {
        sourceField.value = resolvedSourceUrl;
      }
    }

    const syncSourceLink = () => {
      const value = sourceField.value.trim();
      let resolvedValue = value;
      if (core && typeof core.setDataSourceUrl === "function") {
        resolvedValue = core.setDataSourceUrl(value);
        sourceField.value = resolvedValue;
      }
      sourceLink.textContent = resolvedValue;
      sourceLink.href = resolvedValue || "#";
    };

    syncSourceLink();
    sourceField.addEventListener("input", syncSourceLink);
  }
})();
