// a script that only marks that it ran: data-ran="<name>" on <html>, accumulated
var el = document.documentElement;
el.setAttribute("data-ran", ((el.getAttribute("data-ran") || "") + " " + (document.currentScript ? document.currentScript.getAttribute("data-name") : "module")).trim());
