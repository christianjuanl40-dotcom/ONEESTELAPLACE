import Image from "next/image";
import { MapPin, Heart, Users } from "lucide-react";
import { PublicLayout } from "@/components/public-layout";

export default function AboutPage() {
  return (
    <PublicLayout>
      <div className="min-h-screen bg-slate-50 pb-0 overflow-x-hidden">
        {/* Hero Section */}
        <section className="relative h-[45vh] min-h-[400px] flex items-center justify-center bg-slate-900 overflow-hidden">
          <div className="absolute inset-0 opacity-40">
            <Image 
              src="/images/venue-interior.jpg" 
              alt="Venue Interior" 
              fill 
              className="object-cover"
              priority
            />
          </div>
          <div className="relative z-10 text-center px-4 animate-in fade-in slide-in-from-bottom-4 duration-1000">
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-white mb-6 tracking-tight">Our Story</h1>
            <p className="text-lg md:text-xl text-slate-200 max-w-2xl mx-auto">
              Providing the perfect backdrop for your most cherished memories.
            </p>
          </div>
        </section>

        {/* Main Content */}
        <section className="container mx-auto px-4 max-w-6xl py-20">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-16 items-center">
            <div className="space-y-8">
              <div>
                <h2 className="text-3xl font-bold text-slate-900 mb-4">More Than Just a Venue</h2>
                <div className="w-20 h-1.5 bg-amber-600 rounded-full mb-6"></div>
                <p className="text-slate-600 leading-relaxed text-lg mb-4 break-words">
                  Started with a vision to bring people together, One Estela Place has been the home for countless celebrations, from intimate weddings to grand corporate events. We believe that every event is unique, and our space is designed to be a blank canvas for your imagination.
                </p>
                <p className="text-slate-600 leading-relaxed text-lg break-words">
                  Located in the heart of the city, we combine modern elegance with unparalleled service to ensure your special day is absolutely perfect.
                </p>
              </div>
              
              <div className="grid grid-cols-2 gap-8 pt-6 border-t border-slate-200">
                <div className="flex flex-col gap-1">
                  <h4 className="text-4xl font-bold text-slate-900">2000+</h4>
                  <p className="text-sm font-semibold text-amber-600 uppercase tracking-[0.2em]">Events Hosted</p>
                </div>
                <div className="flex flex-col gap-1">
                  <h4 className="text-4xl font-bold text-slate-900">100%</h4>
                  <p className="text-sm font-semibold text-amber-600 uppercase tracking-[0.2em]">Client Satisfaction</p>
                </div>
              </div>
            </div>
            
            <div className="relative h-[400px] sm:h-[500px] md:h-[600px] rounded-2xl overflow-hidden shadow-2xl">
              <Image 
                src="/images/venue-chandelier.png" 
                alt="Venue Details" 
                fill 
                className="object-cover hover:scale-105 transition-transform duration-700"
              />
            </div>
          </div>
        </section>

        {/* Core Values / Features */}
        <section className="bg-white py-24 border-t border-slate-100">
          <div className="container mx-auto px-4 max-w-6xl">
            <div className="text-center mb-16">
              <h2 className="text-3xl font-bold text-slate-900 mb-4">Why Choose One Estela Place</h2>
              <p className="text-slate-500 max-w-2xl mx-auto text-lg">We don't just host events; we craft experiences that you and your guests will remember for a lifetime.</p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="p-4 sm:p-6 lg:p-8 bg-slate-50 rounded-2xl border border-slate-100 hover:shadow-lg transition-all duration-300 hover:-translate-y-1">
                <div className="w-14 h-14 bg-amber-100 rounded-xl flex items-center justify-center text-amber-600 mb-6">
                  <MapPin className="w-7 h-7" />
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-3">Prime Location</h3>
                <p className="text-slate-600 leading-relaxed break-words">Easily accessible with ample parking, making it convenient for all your guests to arrive stress-free and ready to celebrate.</p>
              </div>
              
              <div className="p-4 sm:p-6 lg:p-8 bg-slate-50 rounded-2xl border border-slate-100 hover:shadow-lg transition-all duration-300 hover:-translate-y-1">
                <div className="w-14 h-14 bg-amber-100 rounded-xl flex items-center justify-center text-amber-600 mb-6">
                  <Heart className="w-7 h-7" />
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-3">Dedicated Service</h3>
                <p className="text-slate-600 leading-relaxed break-words">Our experienced staff is committed to assisting you at every step, ensuring a flawless execution of your event from start to finish.</p>
              </div>
              
              <div className="p-4 sm:p-6 lg:p-8 bg-slate-50 rounded-2xl border border-slate-100 hover:shadow-lg transition-all duration-300 hover:-translate-y-1">
                <div className="w-14 h-14 bg-amber-100 rounded-xl flex items-center justify-center text-amber-600 mb-6">
                  <Users className="w-7 h-7" />
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-3">Versatile Spaces</h3>
                <p className="text-slate-600 leading-relaxed break-words">From cozy intimate setups to grand arrangements, our facilities effortlessly adapt to your specific theme and guest count up to 500 guests.</p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </PublicLayout>
  );
}