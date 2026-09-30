//go:build with_acme

package include

import (
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/adapter/certificate"
	"github.com/Rigby-Foundation/NuggetVPN/third_party/sing-box-official/service/acme"
)

func registerACMECertificateProvider(registry *certificate.Registry) {
	acme.RegisterCertificateProvider(registry)
}
