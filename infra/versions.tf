# Terraform とプロバイダーの版を固定する（C-62）。版の決め方は docs/tech-stack.md。
terraform {
  required_version = ">= 1.15.5, < 2.0.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "= 5.26.0"
    }
  }
}
