include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI support for Family DNS (per-device DNS profiles over DoT, served by dnsdist)
LUCI_DEPENDS:=+dnsdist +resolveip +openssl-util +acme-acmesh +acme-acmesh-dnsapi +ddns-scripts
LUCI_PKGARCH:=all

PKG_NAME:=luci-app-familydns
PKG_VERSION:=2.1.0 # x-release-please-version
PKG_RELEASE:=1
PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=Cason Adams <https://github.com/casonadams>

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
